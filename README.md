# Fatebinder: A 3D Multiplayer Roguelike Hackathon Game

`This hackathon was plagued by some of the worst case scenarios, my laptop breaking and the university R/W filesystem thinking I was going to manifest ongoing fued with eduroam. Thankfully I had a desktop at home which I could use through the night. I have never been prouder of a hackathon submission.`

## Overview

Fatebinder 2066 is a 3D multiplayer roguelike game, built with:

 -  Backend: Rust for game logic, procedural generation, physics)
  - Frontend: Three.js for the 3d Rendering (and some vanilla js)
  - Multiplayer: Browserpod node.js with Socket.io
 
Players mine procedural Martian caves in first-person with VR support, with GenAI-woven fates linking crew actions (e.g. someone can save themselves, sacrificing others).

## Tech Stack

### Backend (RusT)

- Tokio: Async runtime for concurrency
- tokio-tungstenite: websockert support 
- noise: perlin noise for procedural cave generation
- nalgebra: 3d math for positions, collisions and physics
- serde/serde.json: serialization for networking sync up
- tracing: for logging and debug

### Frontend js
- Three.js for 3d rendering, fp camera and raycasting
- socket.io-client for realtime multiplayer sync
- regular js

### Assets 
- free mars voxels from kenny.nl and sketchfab
- flat shaders (mostly just red tones for the mars aesthetic lol)
- orbitron font for that retro hud look


## How to play

### Core controlks
1. *WASD* to move around
1. Mouse or VR direction to look around
1. left click to mine
1. right click to attack enemies

## World

Procedural Martian Caves (3D Perlin noise)
16X16X16 voxel chunks generated on demand
red walls, ore deposites, gems, hazards

### Multiplayer
- Socket.io rooms (share the regular qr code to join)
- server-authoritative at 30fps ticks, comes highly and very forcibly suggested
- sync positions, rotations voxel changes, health, inventory etc

#### Fates (GenAi)

on events (dig, collapse, defeat), prompt ai oracle
returns risk/reward effects for the entire party
examples include spawn enemy, buff weapon, cave collapse etc

### Roguelike ( not normally play roguelikes but I got inspired by the Pokemon TCG convention held at uni here)
- PERMADEATH
- loot upgrades that can drop from enemies
- simple AI enemies that chase the nearest player

### Win condition is to collect 100 ore + escape the cave together
### Lose condition is all players are unalived.

### Prereqs

Rust 1.70+
node.js 18+ for browserpod
npm