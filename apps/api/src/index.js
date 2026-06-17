import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

const games = [
  { id: "g1", title: "Game One", executable: "C:\\Games\\GameOne\\game.exe", coverUrl: null, isVisible: true },
  { id: "g2", title: "Game Two", executable: "C:\\Games\\GameTwo\\game.exe", coverUrl: null, isVisible: true }
];

const rooms = new Map();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/games", (_req, res) => {
  res.json({ games });
});

app.post("/rooms", (req, res) => {
  const { hostId = "host-1", gameId = "g1" } = req.body ?? {};
  const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = {
    id: crypto.randomUUID(),
    hostId,
    gameId,
    roomCode,
    status: "LOBBY",
    createdAt: new Date().toISOString()
  };
  rooms.set(roomCode, room);
  res.status(201).json(room);
});

app.get("/rooms/:roomCode", (req, res) => {
  const room = rooms.get(req.params.roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

io.on("connection", (socket) => {
  socket.on("room:join", ({ roomCode, userId }) => {
    socket.join(roomCode);
    socket.to(roomCode).emit("room:member-joined", { userId });
  });

  socket.on("chat:message", ({ roomCode, message, userId }) => {
    io.to(roomCode).emit("chat:message", {
      id: crypto.randomUUID(),
      userId,
      message,
      createdAt: new Date().toISOString()
    });
  });

  socket.on("input:event", ({ roomCode, input }) => {
    socket.to(roomCode).emit("input:event", input);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
