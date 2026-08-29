#!/usr/bin/env python3
"""Build a scaled Salisbury Cathedral: cruciform plan, long nave, transepts,
   flying buttresses, cloisters, and the tall central spire it is famous for."""
import time, sys

CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"

# origin: west end of the nave, on the ground
OX, OY, OZ = 120, 72, 120

STONE  = "stone_bricks"
CHISEL = "chiseled_stone_bricks"
CRACK  = "cracked_stone_bricks"
SLAB   = "stone_brick_slab"
STAIR  = "stone_brick_stairs"
GLASS  = "white_stained_glass"
WALL   = "stone_brick_wall"

def cmd(c):
    with open(CONSOLE, "w") as f:
        f.write(c + "\n")
    time.sleep(0.14)

def fill(x1,y1,z1,x2,y2,z2,block):
    cmd(f"fill {x1} {y1} {z1} {x2} {y2} {z2} {block}")

def setb(x,y,z,block):
    cmd(f"setblock {x} {y} {z} {block}")

cmd("gamerule sendCommandFeedback false")

# ---------------------------------------------------------------- clear site
fill(OX-30, OY-1, OZ-30, OX+95, OY+95, OZ+50, "air")
fill(OX-30, OY-2, OZ-30, OX+95, OY-2, OZ+50, "grass_block")
# stone platform the whole thing sits on
fill(OX-6, OY-1, OZ-16, OX+82, OY-1, OZ+34, "stone_bricks")

# ---------------------------------------------------------------- nave
# long hall running west (OX) to east (OX+70), 16 wide centred on OZ+9
NW, NE = OX, OX+70          # nave west / east
NZ1, NZ2 = OZ, OZ+18        # nave north / south walls
H = 22                      # wall height

fill(NW, OY, NZ1, NE, OY+H, NZ2, STONE)          # solid block
fill(NW+1, OY, NZ1+1, NE-1, OY+H-1, NZ2-1, "air") # hollow it

# aisle arcade: arched openings down both long walls
for x in range(NW+5, NE-3, 7):
    for z in (NZ1, NZ2):
        fill(x, OY+1, z, x+3, OY+8, z, "air")
        setb(x-1, OY+9, z, STAIR + "[facing=east,half=top]")
        setb(x+4, OY+9, z, STAIR + "[facing=west,half=top]")
        fill(x, OY+9, z, x+3, OY+9, z, SLAB)

# clerestory: tall lancet windows above the arcade, the Salisbury signature
for x in range(NW+6, NE-4, 7):
    for z in (NZ1, NZ2):
        fill(x, OY+12, z, x+1, OY+19, z, GLASS)
        setb(x, OY+20, z, SLAB)
        setb(x+1, OY+20, z, SLAB)

print("nave shell done", flush=True)
