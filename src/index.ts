import WebSocket, { WebSocketServer } from "ws";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

let userCount = 0;

type ChatMessage = {
  type: "chat" 
    | "info" 
    | "matched"
    | "find" 
    | "next" 
    | "create-room"
    | "join-room"
    | "chat"
    | "info"
    | "room-created"
    | "room-deleted"
    | "leave-room"
    | "error"
    | "typing";
  message?: string;
  roomId?: string;
  username?: string;
  from?: string;
  isTyping?: boolean;
};

type ChatSocket = WebSocket & {
  partner?: ChatSocket | null;

  // for room chat logic
  username?: string;
  roomId?: string;
  isRoomOwner?: boolean;
};

const waitingQueue = new Set<ChatSocket>();

//room chat data structures
const rooms: Map<string, Set<ChatSocket>> = new Map();
const roomOwners: Map<string, ChatSocket> = new Map();

const usernames = new Map<ChatSocket, string>();


wss.on("connection", (socket: ChatSocket) => {
  console.log("New client connected");

  userCount++;
  broadcastUserCount();

  socket.partner = null;
//   waitingQueue.add(socket);
//   matchUsers();

//   socket.on("message", (data: WebSocket.RawData) => {
//     if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
//       socket.partner.send(data.toString()); // No parsing for now, raw string passed through
//     }
//   });

// for new chat 
socket.on("message", (data: WebSocket.RawData) => {
  let parsed: ChatMessage;

  try {
    parsed = JSON.parse(data.toString()) as ChatMessage;
  } catch (err) {
    console.log("❗Invalid message:", data.toString());
    return;
  }

  if(parsed.type === "find"){
    waitingQueue.add(socket);
    matchUsers();
  }

  // 1. Handle "next" button
  if (parsed.type === "next") {
    console.log("🔄 User requested next chat");

    // Notify the partner if they exist
    if (socket.partner) {
      const infoMsg: ChatMessage = {
        type: "info",
        message: "Stranger left the chat.",
      };
      socket.partner.send(JSON.stringify(infoMsg));
      socket.partner.partner = null;
      waitingQueue.add(socket.partner);
    }

    socket.partner = null;
    waitingQueue.add(socket);
    matchUsers();
    return;
  }

  // 2. Handle regular messages
  if (socket.partner && socket.partner.readyState === WebSocket.OPEN) {
    socket.partner.send(data.toString()); // forward to partner
  }

   //  Typing indicator

     if (parsed.type === "typing") {
  if (socket.partner) {
    // 🔄 Anonymous Chat
    socket.partner.send(JSON.stringify({
      type: "typing",
      isTyping: parsed.isTyping,
    }));
  } else if (socket.roomId && rooms.has(socket.roomId)) {
    // 🧑‍🤝‍🧑 Group Chat
    for (const member of rooms.get(socket.roomId)!) {
      if (member !== socket) {
        member.send(JSON.stringify({
          type: "typing",
          isTyping: parsed.isTyping,
          from: socket.username,
        }));
      }
    }
  }
}

  // 🟩 1. Create Room
    if (parsed.type === "create-room") {
      const username = parsed.username?.trim();
      if (!username) return;

      usernames.set(socket,username);

      const roomId = generateRoomId();
      socket.username = username;
      socket.roomId = roomId;
      socket.isRoomOwner = true;

      rooms.set(roomId, new Set([socket]));
      roomOwners.set(roomId, socket);

      socket.send(JSON.stringify({
        type: "room-created",
        roomId,
        message: `Room created with ID: ${roomId}`,
      }));

      broadcastRoomParticipants(roomId);

      return;
    }

    // 🟦 2. Join Room
    if (parsed.type === "join-room") {
      const username = parsed.username?.trim();
      const roomId = parsed.roomId?.trim();

      usernames.set(socket,username || "Anonymous"); 

      if (!username || !roomId || !rooms.has(roomId)) {
        socket.send(JSON.stringify({
          type: "error",
          message: "Room does not exist.",
        }));
        return;
      }

      socket.username = username;
      socket.roomId = roomId;
      socket.isRoomOwner = false;

      rooms.get(roomId)!.add(socket);

      // Notify other members
      for (const member of rooms.get(roomId)!) {
        if (member !== socket) {
          member.send(JSON.stringify({
            type: "info",
            message: `${username} joined the room.`,
          }));
        }
      }

       broadcastRoomParticipants(roomId);

      return;
    }

    // 🟨 3. Group Chat
    if (parsed.type === "chat" && socket.roomId) {
      const roomId = socket.roomId;
      const message = parsed.message;

      const chatMsg: ChatMessage = {
        type: "chat",
        message,
        from: socket.username || "Anonymous",
      };

      
      for (const member of rooms.get(roomId)!) {
        if(member!== socket){
        member.send(JSON.stringify(chatMsg));
        }
      }

      return;
    }

    // 🟥 4. Unknown message
    // socket.send(JSON.stringify({ type: "error", message: "Unknown message type." }));

    if(parsed.type === "leave-room"){
        const roomId = socket.roomId;

        if(roomId && rooms.has(roomId)){
            const members = rooms.get(roomId);
            members?.delete(socket);

            usernames.delete(socket);
            delete socket.roomId;
            delete socket.partner;

            socket.send(JSON.stringify({ type : "room-left", message: "You left the room." }));

            if(members?.size === 0){
                rooms.delete(roomId);
            }else{
                broadcastRoomParticipants(roomId)
            }
        }
    }
  
});


  socket.on("close", () => {
    console.log("❌ Client disconnected");
    userCount--;
    broadcastUserCount();

    if (socket.partner) {
      const infoMsg: ChatMessage = {
        type: "info",
        message: "Stranger disconnected.",
      };
      socket.partner.send(JSON.stringify(infoMsg));
      socket.partner.partner = null;
      waitingQueue.add(socket.partner);
      matchUsers();
    } else {
      waitingQueue.delete(socket);
    }

    // logic for room deletion 
  const roomId = socket.roomId;
  if (!roomId || !rooms.has(roomId)) return;

  rooms.get(roomId)!.delete(socket);

  // If owner leaves → destroy room
  if (socket.isRoomOwner) {
    for (const member of rooms.get(roomId)!) {
      member.send(JSON.stringify({
        type: "room-deleted",
        message: "Room has been deleted by the owner.",
      }));
    //   member.close();
      member.roomId = undefined;
      member.isRoomOwner = false;
    }

    rooms.delete(roomId);
    roomOwners.delete(roomId);
    console.log(`🗑️ Room ${roomId} deleted by owner`);
  } else {
    // Notify others
    const msg = {
      type: "info",
      message: `${socket.username || "Someone"} left the room.`,
    };

    for (const member of rooms.get(roomId)!) {
      member.send(JSON.stringify(msg));
    }

    // Delete room if empty
    if (rooms.get(roomId)!.size === 0) {
      rooms.delete(roomId);
      roomOwners.delete(roomId);
    }
  }

  // disconnection cleanup
  if(socket.roomId){
    const members = rooms.get(socket.roomId);
    if(members){
        members.delete(socket);
        if(members.size == 0){
            rooms.delete(socket.roomId);
        }else{
            broadcastRoomParticipants(socket.roomId);
        }
    }
  }

  usernames.delete(socket);

  });
});

function matchUsers() {
  const users = Array.from(waitingQueue);
  while (users.length >= 2) {
    const userA = users.pop()!;
    const userB = users.pop()!;

    if (userA.readyState === WebSocket.OPEN && userB.readyState === WebSocket.OPEN){
      userA.partner = userB;
      userB.partner = userA;

      const msg: ChatMessage = {
        type: "matched",
        message: "Matched with a stranger!",
      };

      userA.send(JSON.stringify(msg));
      userB.send(JSON.stringify(msg));

      waitingQueue.delete(userA);
      waitingQueue.delete(userB);
    }
  }
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8); // e.g. "f3a9b1"
}

function broadcastUserCount() {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "users-online", count: userCount }));
    }
  }
}

function broadcastRoomParticipants(roomId: string) {
  const members = rooms.get(roomId);
  if (!members) return;

  const participantNames = Array.from(members).map(
    (member) => usernames.get(member) || 'Anonymous'
  );

  const message = JSON.stringify({
    type: 'participants',
    participants: participantNames,
  });

  for (const member of members) {
    member.send(message);
  }
}



