import {
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  addDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebase } from "./firebase";

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl.split(",").map((s) => s.trim()),
      username: turnUser,
      credential: turnCred,
    });
  } else {
    // Free-tier fallback: metered.ca OpenRelay public TURN.
    // Best-effort, rate-limited; override via NEXT_PUBLIC_TURN_* for production.
    servers.push({
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    });
  }
  return servers;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(),
  iceCandidatePoolSize: 4,
};

export type PeerRole = "host" | "guest";

export interface PeerHandle {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  remoteStream: MediaStream;
  cleanup: () => void;
}

export interface DataPayload {
  t:
    | "hand"
    | "puck"
    | "score"
    | "ready"
    | "reset"
    | "ping"
    | "leave"
    | "chat"
    | "hit"
    | "wall";
  [k: string]: any;
}

type DataHandler = (msg: DataPayload) => void;
type StateHandler = (label: string) => void;

function attachDataChannel(
  dc: RTCDataChannel,
  onMessage: DataHandler,
  onOpen: () => void,
  onClose: () => void,
  onState?: StateHandler
) {
  dc.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  dc.onopen = () => {
    onState?.(`dc:open`);
    onOpen();
  };
  dc.onclose = () => {
    onState?.(`dc:closed`);
    onClose();
  };
  dc.onerror = (e: any) => {
    console.warn("dc error", e);
    onState?.(`dc:error`);
  };
}

function wirePcDiagnostics(pc: RTCPeerConnection, onState?: StateHandler) {
  pc.oniceconnectionstatechange = () => {
    onState?.(`ice:${pc.iceConnectionState}`);
  };
  pc.onconnectionstatechange = () => {
    onState?.(`pc:${pc.connectionState}`);
  };
  pc.onicegatheringstatechange = () => {
    onState?.(`gather:${pc.iceGatheringState}`);
  };
}

export interface CreateOpts {
  onTrack: (s: MediaStream) => void;
  onMessage: DataHandler;
  onOpen: () => void;
  onClose: () => void;
  onState?: StateHandler;
}

export async function createRoom(
  roomId: string,
  localStream: MediaStream,
  opts: CreateOpts
): Promise<{ roomId: string; handle: PeerHandle }> {
  const { db } = getFirebase();
  if (!db) throw new Error("Firebase not initialized");

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const remoteStream = new MediaStream();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    opts.onTrack(remoteStream);
  };
  wirePcDiagnostics(pc, opts.onState);

  // Host creates the data channel
  const dc = pc.createDataChannel("game", { ordered: true, maxRetransmits: 0 });
  attachDataChannel(dc, opts.onMessage, opts.onOpen, opts.onClose, opts.onState);

  const roomRef = doc(db, "rooms", roomId);
  const offerCandidates = collection(roomRef, "offerCandidates");
  const answerCandidates = collection(roomRef, "answerCandidates");

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(offerCandidates, e.candidate.toJSON());
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await setDoc(roomRef, {
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: serverTimestamp(),
    status: "waiting",
  });

  // buffer answer candidates until remote description is set
  const queued: any[] = [];
  let remoteSet = false;

  const unsubRoom = onSnapshot(roomRef, async (snap) => {
    const data = snap.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        remoteSet = true;
        for (const c of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (err) {
            console.warn("addIceCandidate (host queued) failed", err);
          }
        }
        queued.length = 0;
      } catch (err) {
        console.warn("setRemoteDescription (host) failed", err);
      }
    }
  });

  const unsubAns = onSnapshot(answerCandidates, (snap) => {
    snap.docChanges().forEach(async (c) => {
      if (c.type === "added") {
        const cand = c.doc.data();
        if (!remoteSet) {
          queued.push(cand);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (err) {
            console.warn("addIceCandidate (host) failed", err);
          }
        }
      }
    });
  });

  const cleanup = async () => {
    unsubRoom();
    unsubAns();
    try {
      await deleteDoc(roomRef);
    } catch {}
    try {
      pc.close();
    } catch {}
  };

  return {
    roomId,
    handle: { pc, dc, remoteStream, cleanup },
  };
}

export async function joinRoom(
  roomId: string,
  localStream: MediaStream,
  opts: CreateOpts
): Promise<PeerHandle> {
  const { db } = getFirebase();
  if (!db) throw new Error("Firebase not initialized");

  const roomRef = doc(db, "rooms", roomId);
  let snap;
  try {
    snap = await getDoc(roomRef);
  } catch (err: any) {
    if (err?.code === "permission-denied") {
      throw new Error(
        "Firestore denied the read for this room. The Firestore security rules in your Firebase project likely don't allow read on /rooms/*. Open Firebase Console → Firestore → Rules, paste the contents of firestore.rules, and click Publish."
      );
    }
    throw err;
  }
  if (!snap.exists()) throw new Error("Room not found.");
  const data = snap.data();
  if (!data.offer) throw new Error("Room is not ready yet.");
  if (data.answer || data.status === "active") {
    throw new Error("This room is already full.");
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const remoteStream = new MediaStream();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    opts.onTrack(remoteStream);
  };
  wirePcDiagnostics(pc, opts.onState);

  // declare handle FIRST so ondatachannel can safely write to it
  const handle: PeerHandle = {
    pc,
    dc: null,
    remoteStream,
    cleanup: () => {},
  };

  pc.ondatachannel = (e) => {
    handle.dc = e.channel;
    attachDataChannel(
      e.channel,
      opts.onMessage,
      opts.onOpen,
      opts.onClose,
      opts.onState
    );
  };

  const offerCandidates = collection(roomRef, "offerCandidates");
  const answerCandidates = collection(roomRef, "answerCandidates");

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(answerCandidates, e.candidate.toJSON());
  };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  try {
    await updateDoc(roomRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      status: "active",
    });
  } catch (err: any) {
    if (err?.code === "permission-denied") {
      throw new Error(
        "Firestore denied the write to this room. Update Firestore Rules in your Firebase project to allow write on /rooms/*. Open firestore.rules in this repo, paste it into Firebase Console → Firestore → Rules → Publish."
      );
    }
    throw err;
  }

  const unsubOff = onSnapshot(offerCandidates, (snap) => {
    snap.docChanges().forEach(async (c) => {
      if (c.type === "added") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c.doc.data()));
        } catch (err) {
          console.warn("addIceCandidate (guest) failed", err);
        }
      }
    });
  });

  handle.cleanup = () => {
    unsubOff();
    try {
      pc.close();
    } catch {}
  };

  return handle;
}

export function send(handle: PeerHandle, msg: DataPayload) {
  const dc = handle.dc;
  if (dc && dc.readyState === "open") {
    try {
      dc.send(JSON.stringify(msg));
    } catch {}
  }
}
