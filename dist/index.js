"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importStar(require("ws"));
const PORT = 3001;
const wss = new ws_1.WebSocketServer({ port: PORT }, () => {
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
let userCount = 0;
const waitingQueue = new Set();
//room chat data structures
const rooms = new Map();
const roomOwners = new Map();
const usernames = new Map();
wss.on("connection", (socket) => {
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
    socket.on("message", (data) => {
        var _a, _b, _c;
        let parsed;
        try {
            parsed = JSON.parse(data.toString());
        }
        catch (err) {
            console.log("❗Invalid message:", data.toString());
            return;
        }
        if (parsed.type === "find") {
            waitingQueue.add(socket);
            matchUsers();
        }
        // 1. Handle "next" button
        if (parsed.type === "next") {
            console.log("🔄 User requested next chat");
            // Notify the partner if they exist
            if (socket.partner) {
                const infoMsg = {
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
        if (socket.partner && socket.partner.readyState === ws_1.default.OPEN) {
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
            }
            else if (socket.roomId && rooms.has(socket.roomId)) {
                // 🧑‍🤝‍🧑 Group Chat
                for (const member of rooms.get(socket.roomId)) {
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
            const username = (_a = parsed.username) === null || _a === void 0 ? void 0 : _a.trim();
            if (!username)
                return;
            usernames.set(socket, username);
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
            const username = (_b = parsed.username) === null || _b === void 0 ? void 0 : _b.trim();
            const roomId = (_c = parsed.roomId) === null || _c === void 0 ? void 0 : _c.trim();
            usernames.set(socket, username || "Anonymous");
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
            rooms.get(roomId).add(socket);
            // Notify other members
            for (const member of rooms.get(roomId)) {
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
            const chatMsg = {
                type: "chat",
                message,
                from: socket.username || "Anonymous",
            };
            for (const member of rooms.get(roomId)) {
                if (member !== socket) {
                    member.send(JSON.stringify(chatMsg));
                }
            }
            return;
        }
        // 🟥 4. Unknown message
        // socket.send(JSON.stringify({ type: "error", message: "Unknown message type." }));
        if (parsed.type === "leave-room") {
            const roomId = socket.roomId;
            if (roomId && rooms.has(roomId)) {
                const members = rooms.get(roomId);
                members === null || members === void 0 ? void 0 : members.delete(socket);
                usernames.delete(socket);
                delete socket.roomId;
                delete socket.partner;
                socket.send(JSON.stringify({ type: "room-left", message: "You left the room." }));
                if ((members === null || members === void 0 ? void 0 : members.size) === 0) {
                    rooms.delete(roomId);
                }
                else {
                    broadcastRoomParticipants(roomId);
                }
            }
        }
    });
    socket.on("close", () => {
        console.log("❌ Client disconnected");
        userCount--;
        broadcastUserCount();
        if (socket.partner) {
            const infoMsg = {
                type: "info",
                message: "Stranger disconnected.",
            };
            socket.partner.send(JSON.stringify(infoMsg));
            socket.partner.partner = null;
            waitingQueue.add(socket.partner);
            matchUsers();
        }
        else {
            waitingQueue.delete(socket);
        }
        // logic for room deletion 
        const roomId = socket.roomId;
        if (!roomId || !rooms.has(roomId))
            return;
        rooms.get(roomId).delete(socket);
        // If owner leaves → destroy room
        if (socket.isRoomOwner) {
            for (const member of rooms.get(roomId)) {
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
        }
        else {
            // Notify others
            const msg = {
                type: "info",
                message: `${socket.username || "Someone"} left the room.`,
            };
            for (const member of rooms.get(roomId)) {
                member.send(JSON.stringify(msg));
            }
            // Delete room if empty
            if (rooms.get(roomId).size === 0) {
                rooms.delete(roomId);
                roomOwners.delete(roomId);
            }
        }
        // disconnection cleanup
        if (socket.roomId) {
            const members = rooms.get(socket.roomId);
            if (members) {
                members.delete(socket);
                if (members.size == 0) {
                    rooms.delete(socket.roomId);
                }
                else {
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
        const userA = users.pop();
        const userB = users.pop();
        if (userA.readyState === ws_1.default.OPEN && userB.readyState === ws_1.default.OPEN) {
            userA.partner = userB;
            userB.partner = userA;
            const msg = {
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
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8); // e.g. "f3a9b1"
}
function broadcastUserCount() {
    for (const client of wss.clients) {
        if (client.readyState === ws_1.default.OPEN) {
            client.send(JSON.stringify({ type: "users-online", count: userCount }));
        }
    }
}
function broadcastRoomParticipants(roomId) {
    const members = rooms.get(roomId);
    if (!members)
        return;
    const participantNames = Array.from(members).map((member) => usernames.get(member) || 'Anonymous');
    const message = JSON.stringify({
        type: 'participants',
        participants: participantNames,
    });
    for (const member of members) {
        member.send(message);
    }
}
