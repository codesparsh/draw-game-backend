const express = require("express");
const shortid = require('shortid');
const app = express();
const http = require("http").createServer(app);
const { v1: uuidv1, v4: uuidv4 } = require("uuid");
require('dotenv').config();
const nodemailer = require('nodemailer');

const io = require("socket.io")(http, {
  cors: {
    origins: ["http://localhost:4200"],
  },
});


function generateUID() {
  // I generate the UID from two parts here 
  // to ensure the random number provide enough bits.
  var firstPart = (Math.random() * 46656) | 0;
  var secondPart = (Math.random() * 46656) | 0;
  firstPart = ("000" + firstPart.toString(36)).slice(-3);
  secondPart = ("000" + secondPart.toString(36)).slice(-3);
  return firstPart + secondPart;
}

var redis = require("redis");
var redisClient = redis.createClient();

redisClient.on("connect", function () {
  console.log("redis server is up");
});

io.use((socket, next) => {
  let { ghatna } = socket.handshake.auth;
  if (ghatna === "refreshing") {
    let { sessionId, handleId } = socket.handshake.auth;
    if (sessionId && handleId) {
      redisClient.get(sessionId, (err, object) => {
        if (object) {
          let allPeers = JSON.parse(object);
          let { handle } = allPeers.find((h) => h.handleId === handleId);
          socket.handle = handle;
          socket.handleId = handleId;
          socket.sessionId = sessionId;
          socket.ghatna = "refreshing";
          return next();
        }
      });
    }
  } else if (ghatna === "createdRoom") {
    let { handle } = socket.handshake.auth;
    console.log(handle);
    socket.handle = handle+'#'+generateUID();
    socket.sessionId = shortid();
    socket.handleId = uuidv4();
    socket.ghatna = "createdRoom"
    next();
  } else if (ghatna === "joinedRoom") {
    let { handle, sessionId } = socket.handshake.auth;
    socket.handle = handle+'#'+generateUID();
    socket.handleId = uuidv4();
    socket.sessionId = sessionId;
    socket.ghatna = "joinedRoom";
    next();
  }
});

let groupsChats = [];
let lines = [];

io.on("connection", (socket) => {
  console.log("a user connected");

  let { handle, sessionId, handleId } = socket;

  handleInfo = { handle, sessionId, handleId };
  socket.join(`${sessionId}`);

  redisClient.get(`${sessionId} chats`, (err, object) => {
    if (object === null) {
      redisClient.set(`${sessionId} chats`, JSON.stringify([]));
    } else {
      groupsChats = JSON.parse(object);
    }
  });

  for(var i in lines){
    socket.to(`${sessionId}`).emit('draw_line',lines[i])
  }

  socket.on('delete',(data)=>{
    lines.splice(0, lines.length)
  })

  socket.on('draw_line',(data)=>{
    // console.log(data);
    lines.push(data)
    io.to(`${sessionId}`).emit('draw_line',data)
  })

  let msg = [];
  if(socket.ghatna === "refreshing" || socket.ghatna === "joinedRoom") {
    msg = groupsChats;
  }
  socket.emit("selfNetworkInfo", {
    WelcomeMsg: `you have joined the session`,
    handleInfo,
    msg
  });

  socket
    .to(`${sessionId}`)
    .emit("joineeNetworkInfo", `${handle} has joined the room`); //to all clients except the sender

  socket.on("typing", (data) => {
    let { userTyping, roomId } = data;
    if (userTyping != "") {
      socket.to(`${roomId}`).emit("typing", `${userTyping} is typing ...`);
    } else {
      socket.to(`${roomId}`).emit("typing", `${userTyping}`);
    }
  });

  socket.on("emailedList", (data) => {
    console.log(data);
    // Step 1
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL, // TODO: your gmail account
        pass: process.env.PASSWORD, // TODO: your gmail password
      },
    });

    // Step 2
    let mailOptions = {
      from: "shashankkarmakar2000@gmail.com", // TODO: email sender
      to: data, // TODO: email receiver
      subject: "hello comrade",
      text: `hi you have invited to join ${sessionId} room`,
    };

    // Step 3
    transporter.sendMail(mailOptions, (err, data) => {
      if (err) {
        return console.log(err, "Error occurs");
      }
      return console.log("Email sent!!!");
    });
  });

  socket.on("selfMessage", (data) => {
    redisClient.get(`${sessionId} chats`, (err, object) => {
      let chats = JSON.parse(object);
      let chat = data;
      chats.push(chat);
      redisClient.set(`${sessionId} chats`, JSON.stringify(chats));
    });
    socket.to(`${sessionId}`).emit("joineeMessage", data);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
    redisClient.get(sessionId, (err, object) => {
      if (object === null) {
        let peer = {};
        peer = { handleId, handle };
        let peers = [peer];
        redisClient.set(sessionId, JSON.stringify(peers));
      } else {
        let peers = JSON.parse(object);
        let peer = {};
        peer = { handleId, handle };
        peers.push(peer);
        redisClient.set(sessionId, JSON.stringify(peers));
      }
    });
    io.in(`${sessionId}`).emit("joineeNetworkInfo", `${handle} left :(`);
  });
});

http.listen(3000, () => {
  console.log("listening on *:3000");
});
