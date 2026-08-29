#!/usr/bin/env python3
"""Elizabeth Tower (Big Ben) - gothic revival, 96m, four clock faces, spire."""
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"

OX, OY, OZ = -420, 64, -60          # tower centre, ground level

PALE   = "smooth_sandstone"          # Portland-stone look
PALE2  = "cut_sandstone"
TRIM   = "chiseled_sandstone"
DARK   = "polished_blackstone"
GOLD   = "gold_block"
SLAB   = "smooth_sandstone_slab"
STAIR  = "smooth_sandstone_stairs"
WALL   = "sandstone_wall"
GLASS  = "white_stained_glass"
BLACK  = "black_concrete"
WHITE  = "white_concrete"

def cmd(c):
    with open(CONSOLE, "w") as f:
        f.write(c + "\n")
    time.sleep(0.13)

def fill(x1,y1,z1,x2,y2,z2,b): cmd(f"fill {x1} {y1} {z1} {x2} {y2} {z2} {b}")
def setb(x,y,z,b):             cmd(f"setblock {x} {y} {z} {b}")

cmd("gamerule sendCommandFeedback false")

R = 6                                # half-width of the tower
# ---- clear and base ----
fill(OX-R-6, OY-1, OZ-R-6, OX+R+6, OY+110, OZ+R+6, "air")
fill(OX-R-6, OY-2, OZ-R-6, OX+R+6, OY-2, OZ+R+6, "grass_block")
fill(OX-R-3, OY-1, OZ-R-3, OX+R+3, OY-1, OZ+R+3, "stone_bricks")

# ---- plinth ----
fill(OX-R-1, OY, OZ-R-1, OX+R+1, OY+7, OZ+R+1, DARK)
fill(OX-R,   OY, OZ-R,   OX+R,   OY+7, OZ+R,   "air")
fill(OX-R,   OY, OZ-R,   OX+R,   OY,   OZ+R,   "polished_blackstone_bricks")

# ---- main shaft, 60 blocks of pale stone ----
fill(OX-R, OY+8, OZ-R, OX+R, OY+68, OZ+R, PALE)
fill(OX-R+1, OY+8, OZ-R+1, OX+R-1, OY+68, OZ+R-1, "air")

# vertical pilasters at the corners and mid-faces
for dx, dz in [(-R,-R),(R,-R),(-R,R),(R,R),(-R,0),(R,0),(0,-R),(0,R)]:
    fill(OX+dx, OY+8, OZ+dz, OX+dx, OY+68, OZ+dz, PALE2)

# tall lancet windows up the shaft, on all four faces
for base in range(14, 62, 12):
    for dz in (-R, R):
        for dx in (-2, 0, 2):
            fill(OX+dx, OY+base, OZ+dz, OX+dx, OY+base+6, OZ+dz, GLASS)
            setb(OX+dx, OY+base+7, OZ+dz, TRIM)
    for dx in (-R, R):
        for dz in (-2, 0, 2):
            fill(OX+dx, OY+base, OZ+dz, OX+dx, OY+base+6, OZ+dz, GLASS)
            setb(OX+dx, OY+base+7, OZ+dz, TRIM)

# string courses
for y in (OY+20, OY+34, OY+48, OY+62):
    fill(OX-R-1, y, OZ-R-1, OX+R+1, y, OZ+R+1, SLAB)
    fill(OX-R,   y, OZ-R,   OX+R,   y, OZ+R,   "air")

print("shaft done", flush=True)
