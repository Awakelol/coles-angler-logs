"""
Authoring tool for the pixel-art sprites.

Bodies are hand-drawn (head at left, ' ' = transparent, rows auto-padded).
Caudal fins are generated as an outlined *forked* tail so every fish gets a
consistent, correctly-attached tail without hand-counting pixels.

Character map (10 shading slots, matching PALETTES in js/pixel.js):
    O outline    S shadow/top    D dorsal      B body      M midtone
    L belly      H highlight     F fin         A accent
    E eye white  P pupil         . transparent

Run:  python tools/author_sprites.py
Then paste tools/sprites.generated.js into SPRITES in js/pixel.js.
"""

import os
from PIL import Image, ImageDraw

# Reference palette, used for the preview render only.
PAL = {
    'O': '#151b26',  # outline
    'S': '#2d4a63',  # deep shadow along the back
    'D': '#3f6b8a',  # dorsal
    'B': '#6f9ab5',  # body
    'M': '#a3c2d4',  # midtone / dither
    'L': '#d8e8f0',  # belly
    'H': '#ffffff',  # highlight
    'F': '#4e7d9c',  # fins
    'A': '#e8b53c',  # accent
    'E': '#ffffff',
    'P': '#10141c',
}

# name: (fork_depth, rows)   fork_depth None = no caudal fin (squid/crab)
#
# Detail that makes these read as fish rather than blobs, taken from the
# reference art: a pointed snout, a gill line behind the head, a dorsal fin
# that stands proud of the back, and pelvic/anal fins hanging clear underneath
# with a gap of outline between them and the belly.
BODIES = {

# =========================================================================
# DETAIL PASS — what stops these reading as blobs:
#   1. a real EYE: 3x3 socket, white sclera, pupil, plus a highlight pixel
#   2. a MOUTH line and jaw at the snout, not a blunt nose
#   3. an OPERCULUM (gill cover) arc behind the head
#   4. FIN RAYS drawn as alternating F/S columns instead of solid blocks
#   5. a LATERAL LINE running the flank
#   6. species MARKINGS (A) — bars, spots, stripes — that break up the flank
#   7. staggered scale dither rather than uniform horizontal bands
# =========================================================================

# --- snapper: sloped forehead, big eye, deep body (Lutjanidae) ------------
'snapper': (7, [
'                OOOOOOOOOOO',
'              OOFSFSFSFSFSO',
'            OOFSFSFSFSFSFSO',
'        OOOOOFSFSFSFSFSFSFO',
'    OOOOOSSSSSSSSSSSSSSSSSO',
'  OOSSSSSSSSSSSSSSSSSSSSSDO',
' OSSSSSSDDDDDDDDDDDDDDDDDDO',
' OSSDDDDDDDDDDDDDDDDDDDDDDO',
'OOODDDDDBDBDBDBDBDBDBDBDBDO',
'OOOOOODBDBDBDBDBDBDBDBDBDBO',
'OOEEEODBBBBBBBHBBBBBBBBBBBO',
'OEEPPEOBBBBBBHHBBBBBBBBBBBO',
'OEEPPEOMMMMMMMMMMMMMMMMMMMO',
'OOEEEOBMBMBMBMBMBMBMBMBMBBO',
'.OOOOMBMBMBMBMBMBMBMBMBMBBO',
' OOMMMMMMMMMMMMMMMMMMMMMMBO',
'  OMLMLMLMLMLMLMLMLMLMLMLBO',
'  OLMLMLMLMLMLMLMLMLMLMLMBO',
'  OLLLLLLLLLLLLLLLLLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLLLLLLOO',
'  OOHHLLLLLLLLLLLLLLLLLLOO',
'    OOOFSFOOOOFSFSFSFOOOO',
'      OFSFO   OFSFSFO',
'      OOOO    OOOOOO',
]),

# --- barracuda: long snout, underslung jaw, two split dorsals ------------
'barracuda': (7, [
'              OOOOO                   ',
'            OOFSFSFO                  ',
'          OOOFSFSFOO      OOOOO       ',
'      OOOOOSSSSSSSSSSSSOOFSFSFO       ',
'  OOOOSSSSSSSSSSSSSSSSSSSSSSSSSO      ',
' OSSSSSDDDDDDDDDDDDDDDDDDDDDDDDDO     ',
'OSSDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDO    ',
'OODDDBDBDBDBDBDBDBDBDBDBDBDBDBDBDO    ',
'OEEEODBDBDBDBDBDBDBDBDBDBDBDBDBDBO    ',
'OEPPEOMMMMMMMMMMMMMMMMMMMMMMMMMMMO    ',
'OEEEOMBMBMBMBMBMBMBMBMBMBMBMBMBMBO    ',
'OOOOOMMMMMMMMMMMMMMMMMMMMMMMMMMMBO    ',
'.OOOLMLMLMLMLMLMLMLMLMLMLMLMLMLMBO    ',
'  OLLLLLLLLLLLLLLLLLLLLLLLLLLLLLOO    ',
'   OOHLLLLLLLLLLLLLLLLLLLLLLLLLOO     ',
'     OOOOFSFOOOOOOOOOOFSFSFOOOO       ',
'        OFSFO        OFSFSFO          ',
'        OOOO         OOOOOO           ',
]),

# --- trevally / jack: blunt steep head, keeled peduncle (Carangidae) -----
'jack': (8, [
'             OOOOOOOOO',
'           OOFSFSFSFSFO',
'         OOOFSFSFSFSFSFO',
'      OOOOSSSSSSSSSSSSSO',
'   OOOSSSSSSSSSSSSSSSSSSO',
' OOSSSSSSSSSSSSSSSSSSSSSDO',
'OOSSSSDDDDDDDDDDDDDDDDDDDO',
'OSSDDDDDDDDDDDDDDDDDDDDDDO',
'OODDDDBDBDBDBDBDBDBDBDBDBO',
'OOEEEODBDBDBDBDBDBDBDBDBDO',
'OEPPEOBBBBBHBBBBBBBBBBBBBO',
'OEPPEOMMMMHMMMMMMMMMMMMMMO',
'OOEEEOBMBMBMBMBMBMBMBMBMBO',
'.OOOOMBMBMBMBMBMBMBMBMBMBO',
' OOMMMMMMMMMMMMMMMMMMMMMBO',
'  OMLMLMLMLMLMLMLMLMLMLMBO',
'  OLMLMLMLMLMLMLMLMLMLMLBO',
'  OLLLLLLLLLLLLLLLLLLLLLOO',
'   OHHLLLLLLLLLLLLLLLLLOO',
'    OOOFSFOOOOFSFSFSFOOO',
'      OFSFO   OFSFSFO',
'      OOOO    OOOOOO',
]),

# --- mullet: blunt rounded head, small mouth, split dorsals (Mugilidae) --
'mullet': (7, [
'            OOOOO                 ',
'          OOFSFSFO                ',
'        OOOFSFSFOO     OOOOO      ',
'    OOOOOSSSSSSSSSSSOOFSFSFO      ',
'  OOSSSSSSSSSSSSSSSSSSSSSSSSO     ',
' OSSSSDDDDDDDDDDDDDDDDDDDDDDDO    ',
'OOSDDDDDDDDDDDDDDDDDDDDDDDDDDO    ',
'OODDDBDBDBDBDBDBDBDBDBDBDBDBDO    ',
'OEEEODBDBDBDBDBDBDBDBDBDBDBDBO    ',
'OEPPEOBBBBHBBBBBBBBBBBBBBBBBBO    ',
'OEEEEOMMMMMMMMMMMMMMMMMMMMMMMO    ',
'OOOOOMBMBMBMBMBMBMBMBMBMBMBMBO    ',
'.OOMMMMMMMMMMMMMMMMMMMMMMMMMBO    ',
'  OMLMLMLMLMLMLMLMLMLMLMLMLMBO    ',
'  OLLLLLLLLLLLLLLLLLLLLLLLLLOO    ',
'   OOHHLLLLLLLLLLLLLLLLLLLLOO     ',
'     OOOFSFOOOOOOOFSFSFOOOO       ',
'       OFSFO     OFSFSFO          ',
'       OOOO      OOOOOO           ',
]),

# --- eel catfish: barbels, low slung, continuous fin (Plotosidae) --------
'catfish': (4, [
'  AA                                ',
'   AA     OOOOOOOOOOOOOOOOOOO       ',
'    AA  OOFSFSFSFSFSFSFSFSFSFOO     ',
'  OOOOOOOSSSSSSSSSSSSSSSSSSSSSSO    ',
' OSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSO   ',
'OOSSDDDDDDDDDDDDDDDDDDDDDDDDDDDDO   ',
'OEEEODDDBDBDBDBDBDBDBDBDBDBDBDBDO   ',
'OEPPEODBDBDBDBDBDBDBDBDBDBDBDBDBO   ',
'OEEEEOMMMMMMMMMMMMMMMMMMMMMMMMMMO   ',
'OOOOOMBMBMBMBMBMBMBMBMBMBMBMBMBBO   ',
' AAOMMMMMMMMMMMMMMMMMMMMMMMMMMMBO   ',
'  AAOLMLMLMLMLMLMLMLMLMLMLMLMLMBO   ',
'   AAOLLLLLLLLLLLLLLLLLLLLLLLLLOO   ',
'    OOFSFSFSFSFSFSFSFSFSFSFSFSFOO   ',
'     OOOOOOOOOOOOOOOOOOOOOOOOOO     ',
]),

# --- deep-bodied: ponyfish, mojarras -------------------------------------
'deep': (5, [
'          OOOOOOOO',
'         OFFFFFFFO',
'        OFFFFFFFFFO',
'      OOOFFFFFFFFOOO',
'    OOSSSOOOOOOOOSSSOO',
'   OSSSSSSSSSSSSSSSSSO',
'  OSSSSSDDDDDDDDDDDDSO',
' OSDDDDDDDDBBBBBBBBBDO',
'OODDDDDBBBBBBBBBBBBBBO',
'OEPEODDBBBBBBMBMBBBBBO',
'OEEEOBBBBBMBMBMBMBBBBO',
'OOEEOBBMBMBMBMBMBMBBBO',
' OOMMMMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLMBO',
'  OLLLLLLLLLLLLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLOO',
'  OHHLLLLLLLLLLLLLLOO',
'   OOHHLLLLLLLLLLOO',
'     OOOFFFFFFOOO',
'       OFFFFFFO',
'       OOOOOOOO',
]),

# --- perch build: snappers, breams, trevally ------------------------------
'perch': (6, [
'            OOOOOOOOO',
'           OFFFFFFFFO',
'          OFFFFFFFFFFO',
'       OOOOFFFFFFFFFOOO',
'    OOOSSSSOOOOOOOOSSSSOO',
'  OOSSSSSSSSSSSSSSSSSSSSO',
' OSSSSSSDDDDDDDDDDDDDDDSO',
'OODDDDDDDDDDBBBBBBBBBBBDO',
'OEPEODDDDBBBBBBBBBBBBBBBO',
'OEEEOBBBBBBBBMBMBMBBBBBBO',
'OOEEOBBBBMBMBMBMBMBMBBBBO',
' OOMMMBMBMBMBMBMBMBMBMBBO',
'  OMMLMLMLMLMLMLMLMLMLMBO',
'  OLLLLLLLLLLLLLLLLLLLLBO',
'   OHLLLLLLLLLLLLLLLLLLOO',
'   OOHHLLLLLLLLLLLLLLLOO',
'     OOOFFOOOOFFFFOOOO',
'       OFFO   OFFFO',
'       OOOO   OOOO',
]),

# --- streamlined pelagic: mackerel, scad, sardine -------------------------
'torpedo': (7, [
'                OOOO',
'               OFFFFO',
'              OFFFFFO',
'        OOOOOOOFFFFOOOO',
'     OOOSSSSSSSSSSSSSSSOO',
'   OOSSSSSSSSSSSSSSSSSSSSO',
' OOSSDDDDDDDDDDDDDDDDDDDDSO',
'OODDDDDDDDDBBBBBBBBBBBBBBDO',
'OEPEODDDBBBBBBBBBBBBBBBBBBO',
'OEEEOBBBBBBMBMBMBMBMBBBBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBMBBO',
' OOMMMLMLMLMLMLMLMLMLMLMLBO',
'  OLLLLLLLLLLLLLLLLLLLLLLBO',
'   OOHLLLLLLLLLLLLLLLLLLLOO',
'     OOOHHLLLLLLLLLLLLLLOO',
'        OOOOOFFOOOFFOOOOO',
'             OFFO OFFO',
'              OO   OO',
]),

# --- tuna: thick shoulders, sickle fins, finlets along the peduncle -------
'tuna': (8, [
'           OOOO              ',
'          OFFFFO             ',
'         OFFFFFFO            ',
'        OFFFFFFFFO           ',
'     OOOOFFFFFFFFOOOO        ',
'   OOSSSSOOOOOOOOSSSSSOO     ',
' OOSSSSSSSSSSSSSSSSSSSSSOO   ',
'OODDDDDDDDDDDDDDDDDDDDDDDSO  ',
'OEPEODDDDDBBBBBBBBBBBBBBBDAO ',
'OEEEOBBBBBBBBBBMBMBMBBBBBBAO ',
'OOEEOBBBBBMBMBMBMBMBMBBBBBAO ',
' OOMMMMBMBMBMBMBMBMBMBMBMBAO ',
'  OMLLLLLLLLLLLLLLLLLLLLLLBO ',
'  OLLLLLLLLLLLLLLLLLLLLLLLOO ',
'  OOHLLLLLLLLLLLLLLLLLLLLAO  ',
'   OOOHHLLLLLLLLLLLLLLLLAO   ',
'     OOOOFFFFFOOOOOOOOOO     ',
'        OFFFFFFO             ',
'         OOOOOO              ',
]),

# --- grouper: heavy head, big rounded fins, mottled flanks ----------------
'grouper': (4, [
'          OOOOOOOOOOO',
'         OFFFFFFFFFFFO',
'       OOOFFFFFFFFFFFFO',
'    OOOSSSOOOOOOOOOOOOOO',
'  OOSSSSSSASSSSASSSSSSSSO',
' OSSSSSSSSSSSSSSSSSSSSSDO',
'OODDDADDDDDDDDADDDDDDDDDO',
'OEPEODDDBBBBABBBBBBBABBBO',
'OEEEOBBBBBBBBBBBABBBBBBBO',
'OOEEOBBABBBBMBMBMBBBABMBO',
' OOMMMBBBBMBMBMBMBMBMBMBO',
'  OMMLMLALMLMLMLMLALMLMBO',
'  OLLLLLLLLLLLLALLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLLLLOO',
'  OOHHLLLLLLLLLLLLLLLLOO',
'    OOOFFFFOOOOFFFFFOOO',
'      OFFFFO  OFFFFFO',
'      OOOOOO  OOOOOO',
]),

# --- barracuda / needlefish: long and lean --------------------------------
'long': (6, [
'              OOOOOO         ',
'             OFFFFFO         ',
'          OOOOFFFFOOOOO      ',
'   OOOOOOOSSSSOOOOSSSSSSOO   ',
' OOSSSSSSSSSSSSSSSSSSSSSSSSO ',
'OODDDDDDDDDDDDDDDDDDDDDDDDDSO',
'OEPEODDDDBBBBBBBBBBBBBBBBBBDO',
'OEEEOBBBBBBBBBBBBBBBBBBBBBBBO',
'OOEEOBMBMBMBMBMBMBMBMBMBMBMBO',
' OOMMMLLLLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLLLLLLOO',
'  OOHLLLLLLLLLLLLLLLLLLLLLOO ',
'    OOOOFFOOOOOOOOFFFOOOOO   ',
'       OFFO      OFFO        ',
'       OOOO      OOOO        ',
]),

# --- rabbitfish / spinefoot: oval body, spiny dorsal ----------------------
'oval': (5, [
'      A A A A A A A',
'      OAOAOAOAOAOAO',
'     OOFFFFFFFFFFFOO',
'   OOOFFFFFFFFFFFFFOOO',
'  OOSSSOOOOOOOOOOOOSSSOO',
' OSSSSSSSSSSSSSSSSSSSSSO',
' OSSSSSDDDDDDDDDDDDDDDDO',
'OODDDDDDDBBBBBBBBBBBBBBO',
'OEPEODDDBBBBBBMBMBBBBBBO',
'OEEEOBBBBBMBMBMBMBMBBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBO',
' OOMMMMLMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLBO',
'  OHLLLLLLLLLLLLLLLLLLOO',
'  OOHHLLLLLLLLLLLLLLLOO',
'    OOOFFFFFFFFFFFFOO',
'      OFFFFFFFFFFO',
'      OOOOOOOOOOOO',
]),

# --- milkfish / mullet: sleek, huge deeply forked tail --------------------
'forked': (9, [
'          OOOOOOO',
'         OFFFFFFFO',
'        OFFFFFFFFFO',
'      OOOFFFFFFFFOOO',
'   OOOSSSOOOOOOOOSSSSOO',
' OOSSSSSSSSSSSSSSSSSSSSO',
'OOSSSSDDDDDDDDDDDDDDDDSO',
'OODDDDDDDDBBBBBBBBBBBBDO',
'OEPEODDDBBBBBBBMBMBBBBBO',
'OEEEOBBBBBBMBMBMBMBMBBBO',
'OOEEOBBMBMBMBMBMBMBMBMBO',
' OOMMMMLMLMLMLMLMLMLMLBO',
'  OMLLLLLLLLLLLLLLLLLLBO',
'  OLLLLLLLLLLLLLLLLLLLOO',
'  OOHLLLLLLLLLLLLLLLLOO',
'   OOOHHLLLLLLLLLLLLOO',
'     OOOOFFFOOOOOOOO',
'        OFFFFO',
'        OOOOOO',
]),

# --- squid ----------------------------------------------------------------
'squid': (None, [
'        OOOOOO',
'      OOSSAASSOO',
'     OSSAAAAAASO',
'    OSSAAAAAAAASO',
'   OSBBBBBBBBBBBSO',
'   OBBBBBBBBBBBBBO',
'  OBBBEPBBBBBBEPBBO',
'  OBBBEEBBBBBBEEBBO',
'  OBBBBBBBBBBBBBBBO',
'  OBMBMBMBMBMBMBMBO',
'   OMMMMMMMMMMMMMO',
'   OLOLOLOLOLOLOLO',
'   OL OL OL OL OLO',
'  OL  O   O   O  LO',
'  O   O   O   O   O',
]),

# --- crab -----------------------------------------------------------------
'crab': (None, [
'',
'   OO             OO',
'  OAAO  OOOOOOO  OAAO',
'  OAAOOOSSSSSSSOOOAAO',
'   OOOSSEPSSSEPSSOOO',
'    OSBBBBBBBBBBBBSO',
'   OSBBBBBBBBBBBBBBSO',
'  OOBBBBBBBBBBBBBBBBOO',
' O OOBBBBMBMBMBMBBBOO O',
' O  OOMMMMMMMMMMMMOO  O',
'  O  O OOOOOOOOOO O  O',
'  O  O  O      O  O  O',
'     O  O      O  O',
]),
}


# =========================================================================
# HEROES — large angled art, shown ONLY on the species detail sheet.
#
# Style, taken from the reference art:
#   - body on a ~35 degree axis, nose upper-right, tail lower-left
#   - NO black outline: 'O' is the palette's darkest slot, which is a dark
#     shade of the body hue (crimson's O is #2b0f14, a dark red), so the
#     silhouette self-outlines instead of looking like a sticker
#   - a bright specular streak (H) down the upper flank — this is what makes
#     them read as living fish rather than flat shapes
#   - smooth tonal blocks S -> D -> B -> M -> L, dither used sparingly
#   - small eye set high on the head, sclera + pupil + one highlight pixel
#
# Tails are hand-drawn here: the fan generator only works on horizontal
# bodies, so HEROES are built with fork=None.
# =========================================================================
HEROES = {

'snapper': [
'                      OOOO      ',
'                    OOSSSSOO    ',
'                  OOSSDDDDSSO   ',
'                 OSSDDDDDDDSSO  ',
'               OOSDDDDDDDDDDDSO ',
'              OSSDDDDDDDDDDDDSO ',
'            OOSDDDDDDDDDDDDDDSO ',
'           OSSDDDDDDDDDDDDEPDSO ',
'         OOSDDDDDDDDDDDDDDEEDSO ',
'        OSSDDDDDDHDDDDDDDDDDSO  ',
'      OOSDDDDDDDHHDDDDDDDDDSO   ',
'     OSSDDDDDDDHHBBBBBBBBDSO    ',
'    OSDDDDDDDDHHBBBBBBBBDSO     ',
'   OSDDDDDDDDHHBBBBBBBBDSO      ',
'  OSDDDDDDDDHHBBBBBBBBDSO       ',
' OSDDDDDDDDHHBBBBBBBBDSO        ',
' OSDDDDDDDHHBBBBBBBBDSO         ',
'OSDDDDDDDHHBBBBBBBBDSO          ',
'OSDDDDDDHHBBBBBBBBDSO           ',
'OSDDDDDHHBBBBBBBBMSO            ',
'OSDDDDDHBBBBBBBBMSO             ',
'OSSDDDDBBBBBBBBMSO              ',
'OOSDDDDBBBBBBBMSO               ',
' OSSDDDBBBBBBMSO                ',
'  OSSDDBBBBBMSO                 ',
'   OSSDDBBBMSO                  ',
' OO OSSDDBMSO                   ',
'OSSO OSSDMSO                    ',
'OSSSO OSSSO                     ',
' OSSSO OOO                      ',
'  OSSSSO                        ',
'   OOOOO                        ',
],
}

# =========================================================================
# ICONS — non-species art. Rendered with the dedicated 'weather' palette,
# which carries five cloud tones (S->H) plus two golds (F edge, A core) so
# clouds have real depth and the sun has a rim rather than being flat.
# =========================================================================
ICONS = {

# Round disc with a darker rim (F), a bright core offset up-left (H), and
# eight separated rays. The rays must not touch the disc or it reads as a gear.
'sunny': [
'                    ',
'         FF         ',
'   F     FF     F   ',
'    F          F    ',
'       FFFFFF       ',
'     FFAAAAAAFF     ',
'    FAAAHHHAAAAF    ',
'   FAAAHHHHHAAAAF   ',
'   FAAHHHHHAAAAAF   ',
'FF FAAAHHHAAAAAAF FF',
'   FAAAAAAAAAAAAF   ',
'   FAAAAAAAAAAAAF   ',
'    FAAAAAAAAAAF    ',
'     FFAAAAAAFF     ',
'       FFFFFF       ',
'    F          F    ',
'   F     FF     F   ',
'         FF         ',
],

# Crescent: convex left edge, concave right. Rim in F, body in A.
'moon': [
'                    ',
'         FFFFF      ',
'  F    FFAAAAAF     ',
'      FFAAAAAF      ',
'     FFAAAAF        ',
'     FAAAAF         ',
' F   FAAAAF         ',
'     FAAAAF         ',
'     FFAAAAF        ',
'      FFAAAAAF      ',
'       FFAAAAAF     ',
'         FFFFF      ',
'                    ',
],

'cloudy': [
'                    ',
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
' ODBBMMMMMMMMMBBDO  ',
' OSDDBBBBBBBBBDDSO  ',
'  OOSSSSSSSSSSSOO   ',
'                    ',
],

'partly': [
'              FAA   ',
'           FFAAAAAF ',
'          FAAAHHAAF ',
'    OOOO  FAAAHHAAF ',
'  OOHHHHOOFAAAAAAAF ',
' OLHHHHHHHOFAAAAAF  ',
' OMLLHHHHHHOFFFFF   ',
' OBMMLLLLLLLO       ',
' ODBBMMMMMMMBO      ',
' OSDDBBBBBBBDSO     ',
'  OOSSSSSSSSSOO     ',
'                    ',
],

'drizzle': [
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
' ODBBMMMMMMMMMBBDO  ',
'  OOSSSSSSSSSSSOO   ',
'                    ',
'    D   D   D       ',
'                    ',
'   D   D   D        ',
'                    ',
],

'rain': [
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
' ODBBMMMMMMMMMBBDO  ',
'  OOSSSSSSSSSSSOO   ',
'                    ',
'   D   D   D   D    ',
'   D   D   D   D    ',
'                    ',
'  D   D   D   D     ',
'  D   D   D   D     ',
],

'showers': [
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
' ODBBMMMMMMMMMBBDO  ',
'  OOSSSSSSSSSSSOO   ',
'                    ',
'  D  D  D  D  D     ',
' D  D  D  D  D      ',
'  D  D  D  D  D     ',
' D  D  D  D  D      ',
],

'storm': [
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
' ODBBMMMMMMMMMBBDO  ',
'  OOSSSSSSSSSSSOO   ',
'          FAAAF     ',
'         FAAAF      ',
'        FAAAF       ',
'      FAAAAAAAF     ',
'         FAAF       ',
'        FAAF        ',
'        FAF         ',
],

'fog': [
'                    ',
'       OOOOO        ',
'     OOHHHHHOO      ',
'    OHHHHHHHHHO     ',
'  OOLHHHHHHHHHLOO   ',
' OLLLHHHHHHHHHLLLO  ',
' OMLLLLHHHHHLLLLMO  ',
' OBMMLLLLLLLLLMMBO  ',
'  OOSSSSSSSSSSSOO   ',
'                    ',
'  MMMMMMMMMMMMMM    ',
'                    ',
' MMMMMMMMMMMMMM     ',
'                    ',
'  MMMMMMMMMMMM      ',
],

# Curling breaker: face rising left to right, crest turning over into a
# hollow barrel, foam down the face. Modelled on the reference art rather
# than the twin humps this used to be.
# Curling breaker: face rises left to right, crest turns over into a hollow
# barrel, foam cap on top. Kept to four tones so it still reads at 40px.
'wave': [
'                        ',
'              LLLLLL    ',
'          LLLLMMMMMMLL  ',
'        LLMMMMMBBBBBMML ',
'       LMMMBBBBB    BMML',
'      LMMBBBBDDD     BML',
'     LMMBBBDDDDD     BML',
'    LMMBBBDDDSSS    BBML',
'   LMMBBBDDDSSSS   BBML ',
'  LMMBBBDDDSSSSS BBBML  ',
' LMMBBBDDDSSSSSBBBBML   ',
'LMMBBBDDDSSSSSBBBBML    ',
'LMMBBDDDSSSSSBBBBML     ',
'BBDDDSSSSSSSSSSSSSSSSSSB',
'DDSSSSSSSSSSSSSSSSSSSSDD',
],

# Traditional J-hook: eye at the top, straight shank, U-bend, point turning
# back up. Strokes are 2px — a 1px line reads as spindly noise at 40px, and
# an added barb turned the bend into an unreadable tangle.
'hook': [
'      AAAAAA      ',
'     AA    AA     ',
'     AA    AA     ',
'      AAAAAA      ',
'        AA        ',
'        AA        ',
'        AA        ',
'        AA        ',
'        AA        ',
'        AA        ',
'        AA        ',
'        AA        ',
'   AA   AA        ',
'   AA   AA        ',
'   AA   AA        ',
'   AAA AA         ',
'    AAAAA         ',
'     AAA          ',
],

'trophy': [
'   BBBBBBBBBB     ',
'  BOOOOOOOOOOB    ',
' BMOLLLLLLLLOMB   ',
' BMOLMMMMMMLOMB   ',
' BMOMMMMMMMMOMB   ',
'  BOMMMMMMMMOB    ',
'   BOMMMMMMOB     ',
'    BOMMMMOB      ',
'     BBMMBB       ',
'       BB         ',
'     BBBBBB       ',
'   BBBBBBBBBB     ',
],

# Bangka / pump boat: narrow hull with bamboo outriggers either side, which
# is what people actually fish from here — not the generic launch this was.
# Bangka / pump boat, seen head-on. Side-on the outrigger arms and float
# stack into yet another horizontal bar and it reads as a layered ferry;
# from the front the cross-beam and two floats give the unmistakable
# outrigger silhouette.
'boat': [
'             AA           ',
'             AAAA         ',
'             AA           ',
'             SS           ',
'        SSSSSSSSSS        ',
'       SLLLLLLLLLLS       ',
'       SSSSSSSSSSSS       ',
'   SSSSSSSSSSSSSSSSSSSS   ',
'   SS    SBBBBBBS    SS   ',
'  SBBS   SBBBBBBS   SBBS  ',
'  SBBS   SBBBBBBS   SBBS  ',
'  SSSS    SBBBBS    SSSS  ',
'   SS      SSSS      SS   ',
'                          ',
'MMLLMMLLMMLLMMLLMMLLMMLLMM',
],

'book': [
'  OOOOOOOOOOOOOO  ',
'  OBBBBBBOBBBBBO  ',
'  OBLLLLBOBLLLLO  ',
'  OBLLLLBOBLLLLO  ',
'  OBBBBBBOBBBBBO  ',
'  OBLLLLBOBLLLLO  ',
'  OBLLLLBOBLLLLO  ',
'  OBBBBBBOBBBBBO  ',
'  OOOOOOOOOOOOOO  ',
],
}


def build(fork, rows):
    grid = [list(r.replace(' ', '.')) for r in rows]
    w = max((len(r) for r in grid), default=0)
    for r in grid:
        r.extend('.' * (w - len(r)))

    if fork is not None:
        occupied = [(y, x) for y, r in enumerate(grid) for x, c in enumerate(r) if c != '.']
        ys = [y for y, _ in occupied]
        attach = max(x for _, x in occupied) + 1
        cy = (min(ys) + max(ys)) / 2
        half = max((max(ys) - min(ys)) / 2, 1e-6)

        total_w = attach + fork + 2
        for r in grid:
            r.extend('.' * (total_w - len(r)))

        # A caudal fin attaches at a narrow peduncle and flares outward, with a
        # notch cut into the trailing edge. Building it column by column (rather
        # than row by row) is what gives it that shape instead of a flat slab.
        ped_half = max(half * 0.26, 1.2)   # height where it meets the body
        tip_half = half * 1.02             # height at the outer lobes

        for i in range(fork + 1):
            t = i / fork
            hh = ped_half + (tip_half - ped_half) * t
            # The notch only starts once the fin has flared out a little.
            notch = 0.0 if t < 0.45 else (t - 0.45) / 0.55 * hh * 0.85
            x = attach + i
            if x >= total_w:
                break
            for y in range(len(grid)):
                dy = abs(y - cy)
                if dy <= hh and dy >= notch and grid[y][x] == '.':
                    grid[y][x] = 'F'

        for y, r in enumerate(grid):
            for x, c in enumerate(r):
                if c != 'F':
                    continue
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < len(grid) and 0 <= nx < len(grid[0]) and grid[ny][nx] == '.':
                        grid[ny][nx] = 'O'

    w = max(len(r) for r in grid)
    for r in grid:
        r.extend('.' * (w - len(r)))

    out = [''.join(r) for r in grid]
    while out and set(out[0]) == {'.'}:
        out.pop(0)
    while out and set(out[-1]) == {'.'}:
        out.pop()
    return out


def rotate(grid, degrees, scale=3):
    """
    Build an angled hero from a horizontal sprite.

    Hand-drawing diagonal bodies row by row is unreliable — the silhouette
    drifts and reads as a sausage. Instead the horizontal art, which is
    already tuned, is supersampled, rotated with nearest-neighbour sampling
    (so pixels stay hard rather than blurring), then majority-downsampled.
    A cleanup pass fills pinholes and re-outlines the result.
    """
    import math

    h, w = len(grid), len(grid[0])
    big_h, big_w = h * scale, w * scale
    big = [[grid[y // scale][x // scale] for x in range(big_w)] for y in range(big_h)]

    rad = math.radians(degrees)
    cos_t, sin_t = math.cos(rad), math.sin(rad)
    # Output canvas sized to hold the rotated bounding box.
    out_w = int(abs(big_w * cos_t) + abs(big_h * sin_t)) + 2
    out_h = int(abs(big_w * sin_t) + abs(big_h * cos_t)) + 2
    cx_i, cy_i = big_w / 2, big_h / 2
    cx_o, cy_o = out_w / 2, out_h / 2

    rot = [['.'] * out_w for _ in range(out_h)]
    for y in range(out_h):
        for x in range(out_w):
            dx, dy = x - cx_o, y - cy_o
            sx = cos_t * dx + sin_t * dy + cx_i
            sy = -sin_t * dx + cos_t * dy + cy_i
            ix, iy = int(round(sx)), int(round(sy))
            if 0 <= ix < big_w and 0 <= iy < big_h:
                rot[y][x] = big[iy][ix]

    # Majority downsample back to pixel-art density.
    ow, oh = out_w // scale, out_h // scale
    small = [['.'] * ow for _ in range(oh)]
    for y in range(oh):
        for x in range(ow):
            tally = {}
            for dy in range(scale):
                for dx in range(scale):
                    c = rot[y * scale + dy][x * scale + dx]
                    tally[c] = tally.get(c, 0) + 1
            # Prefer any real colour over transparency unless it dominates.
            solid = {k: v for k, v in tally.items() if k != '.'}
            if solid and tally.get('.', 0) <= (scale * scale) // 2:
                small[y][x] = max(solid, key=solid.get)

    # Fill pinholes: a transparent pixel ringed by body becomes body.
    for y in range(1, oh - 1):
        for x in range(1, ow - 1):
            if small[y][x] != '.':
                continue
            ring = [small[y - 1][x], small[y + 1][x], small[y][x - 1], small[y][x + 1]]
            solid = [c for c in ring if c != '.']
            if len(solid) >= 4:
                small[y][x] = max(set(solid), key=solid.count)

    # Re-outline: any transparent pixel touching non-outline body becomes O.
    for y in range(oh):
        for x in range(ow):
            if small[y][x] != '.':
                continue
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < oh and 0 <= nx < ow and small[ny][nx] not in ('.', 'O'):
                    small[y][x] = 'O'
                    break

    out = [''.join(r) for r in small]
    while out and set(out[0]) == {'.'}:
        out.pop(0)
    while out and set(out[-1]) == {'.'}:
        out.pop()
    return out


sprites = {n: build(f, rows) for n, (f, rows) in BODIES.items()}
icons = {n: build(None, rows) for n, rows in ICONS.items()}

# Heroes are derived from the horizontal art. The source sprites face LEFT,
# so each is mirrored first, then tilted — putting the nose up-right and the
# tail down-left, matching the reference art.
HERO_ANGLE = -32
heroes = {
    n: rotate([r[::-1] for r in g], HERO_ANGLE)
    for n, g in sprites.items()
    if n not in ('squid', 'crab')
}

for label, coll in (('sprite', sprites), ('icon', icons), ('hero', heroes)):
    for n, g in coll.items():
        assert len({len(r) for r in g}) == 1, f"{label} {n} has ragged rows"
        stray = {c for r in g for c in r} - set(PAL) - {'.'}
        assert not stray, f"{label} {n} has stray characters {stray}"

# ---------------------------------------------------------------- preview
HERE = os.path.dirname(os.path.abspath(__file__))

# Icons use the weather palette so clouds show depth and the sun has a rim.
WEATHER_PAL = {
    'O': '#1b2430', 'S': '#5b6b80', 'D': '#8496ab', 'B': '#aebccd',
    'M': '#d5e0ea', 'L': '#f2f7fb', 'H': '#ffffff',
    'F': '#d99b23', 'A': '#ffd23f', 'E': '#ffffff', 'P': '#10141c',
}


def sheet(coll, palette, path, cols=4, scale=7, palette_for=None):
    names = list(coll)
    rows_n = (len(names) + cols - 1) // cols
    maxw = max(len(g[0]) for g in coll.values())
    maxh = max(len(g) for g in coll.values())
    pad = 14
    cw, ch = maxw * scale + pad * 2, maxh * scale + pad * 2 + 16
    img = Image.new('RGB', (cw * cols, ch * rows_n), '#fff8e7')
    d = ImageDraw.Draw(img)
    for i, name in enumerate(names):
        ox, oy = (i % cols) * cw + pad, (i // cols) * ch + pad
        pal = (palette_for or {}).get(name, palette)
        for y, row in enumerate(coll[name]):
            for x, c in enumerate(row):
                if c in pal:
                    d.rectangle([ox+x*scale, oy+y*scale,
                                 ox+x*scale+scale-1, oy+y*scale+scale-1], fill=pal[c])
        d.text((ox, oy + maxh*scale + 2), name, fill='#333')
    img.save(path)
    return maxw, maxh


CRIMSON = {
    'O': '#2b0f14', 'S': '#7d1226', 'D': '#a11d33', 'B': '#d94257',
    'M': '#ec7d8e', 'L': '#ffd9de', 'H': '#fff5f6', 'F': '#b8283f',
    'A': '#ffb703', 'E': '#ffffff', 'P': '#10141c',
}

# Icons are rendered in the app with different colourways, so preview each
# with the one it actually uses — a wave judged in cloud-grey is meaningless.
OCEAN = {'O': '#0b1a28', 'S': '#14536b', 'D': '#1f6f8b', 'B': '#3fa9c9', 'M': '#7fcbe0',
         'L': '#dff3fa', 'H': '#ffffff', 'F': '#1a7f9c', 'A': '#ffd23f',
         'E': '#ffffff', 'P': '#10141c'}
SUNSET = {'O': '#2a1004', 'S': '#8a2c06', 'D': '#c2410c', 'B': '#f97316', 'M': '#fca55d',
          'L': '#ffe8d1', 'H': '#fff7ed', 'F': '#d1500e', 'A': '#ffd23f',
          'E': '#ffffff', 'P': '#10141c'}
GOLD = {'O': '#2e2208', 'S': '#7d5410', 'D': '#b07d1a', 'B': '#e8b53c', 'M': '#f2cf7a',
        'L': '#fff2cc', 'H': '#fffaeb', 'F': '#c9911f', 'A': '#f26430',
        'E': '#ffffff', 'P': '#10141c'}
ICON_PAL = {
    'wave': OCEAN, 'boat': OCEAN, 'book': OCEAN,
    'hook': SUNSET, 'trophy': GOLD,
}

sw, sh = sheet(sprites, PAL, os.path.join(HERE, 'sprite-preview.png'))
iw, ih = sheet(icons, WEATHER_PAL, os.path.join(HERE, 'icon-preview.png'), cols=4, scale=9,
               palette_for=ICON_PAL)
if heroes:
    sheet(heroes, CRIMSON, os.path.join(HERE, 'hero-preview.png'), cols=3, scale=10)

# ---------------------------------------------------------------- emit JS
def emit(coll):
    out = []
    for name, g in coll.items():
        body = ',\n'.join("    '%s'" % r for r in g)
        out.append("  %s: [\n%s,\n  ]," % (name, body))
    return '\n'.join(out)


with open(os.path.join(HERE, 'sprites.generated.js'), 'w', encoding='utf-8') as f:
    f.write(emit(sprites))
with open(os.path.join(HERE, 'icons.generated.js'), 'w', encoding='utf-8') as f:
    f.write(emit(icons))
with open(os.path.join(HERE, 'heroes.generated.js'), 'w', encoding='utf-8') as f:
    f.write(emit(heroes))

print(f"{len(sprites)} sprites (max {sw}x{sh}), {len(icons)} icons (max {iw}x{ih})")
print("previews -> tools/sprite-preview.png, tools/icon-preview.png")
