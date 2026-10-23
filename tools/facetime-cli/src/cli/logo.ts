// The Chert mark, drawn for a terminal at least 96 columns wide.
const art = String.raw`
                                                          ============
                                                    =======================
                                                 ============================
                                             ==================================
                                          ================            ===========
                                      =================                 ==========
                                   ================                       =========
                                ===============                            =========
                             ===============                                =========
                         ================            ==============           ========
                      ===============            ====================         =========
                    =============-            =========================        =========
                 ==============           ==============================        ========+
                ============           ==================================        =====++++
              ===========          =======================================        ==++++++
             =========           ==========================================        +++++***
            =========         ========================================++++++       ++++****
            ========         ===================================++++++++++++        ********
            ========        ===============================+++++++++++++*****       ******###
            ========       =============================++++++++++************       ****####
            ========      ==========================+++++++++*************####        **######
            ========      =======================++++++++***********###########       ########
            ========      ====================++++++++********#################        ########
            ========      =================++++++++********#####################       ########
             =======       ============+++++++++*******#####################%%%%       ########
             ========      ========+++++++++********###############%%%%%%%%%%%%%%       ####%%%%
             ========      ++++++++++++++********##############%%%%%%%%%%%%%%%%%%       ##%%%%%%
              ========      +++++++++*********##############%%%%%%%%%%%%%%%%%%%%%       %%%%%%%%
              ========      *+************###############%%%%%%%%%%%%%%%%%%%%%%%%       %%%%%%%%
              ========       *********################%%%%%%%%%%%%%%%%%%%%%%%%%%        %%%%%%%%
               ========      **####################%%%%%%%%%%%%%%%%%%%%%%%%%%%%        %%%%%%%%
               ========       ##################%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%        %%%%%%%%%
                ========      #############%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%
                ========       #########%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%
                =========       #####%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%
                 ========        %#%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%%
                  ====++++         %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%
                  +++++++++           %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%%
                    ++++*****             %%%%%%%%%%%%%%%%%%%%%%%%         %%%%%%%%%%
                     ********###               %%%%%%%%%%%%%%%%           %%%%%%%%%%
                      ***###########                                    %%%%%%%%%%
                        ###############%                              %%%%%%%%%%
                           ##########%%%%%%%%                       %%%%%%%%%%%
                               ###%%%%%%%%%%%%%%%%%               %%%%%%%%%%%
                                   %%%%%%%%%%%%%%%%%%%%%%%##%%%%%%%%%%%%%%%
                                       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
                                            %%%%%%%%%%%%%%%%%%%%%%%%%%%
                                                  %%%%%%%%%%%%%%%%%%
`;

const lines = art.split('\n').filter(line => line.trim().length > 0);
const indent = Math.min(...lines.map(line => line.length - line.trimStart().length));
/** The mark with its common left margin removed. */
export const logoLines: readonly string[] = lines.map(line => line.slice(indent).trimEnd());
export const logoWidth = Math.max(...logoLines.map(line => line.length));

/** How heavy each drawing character is, lightest first. The mark darkens from its top edge to its base. */
const WEIGHTS = '=-+*#%';
export interface MarkCell { char: string; shade: number }

/**
 * The mark redrawn in braille dots, `width` characters wide. Each character carries a 2 by 4 grid of dots, so the
 * shape keeps its detail at about a third of the size. `shade` runs from 0 (lightest part of the mark) to 5.
 */
export function brailleMark(width: number): MarkCell[][] {
  const dotsWide = width * 2;
  // A terminal character is about twice as tall as it is wide, so one source row covers two dot rows.
  const dotsHigh = Math.round(dotsWide * (logoLines.length * 2) / logoWidth);
  const rows = Math.ceil(dotsHigh / 4);
  const sample = (x: number, y: number) => logoLines[Math.floor((y + 0.5) * logoLines.length / dotsHigh)]?.[Math.floor((x + 0.5) * logoWidth / dotsWide)] ?? ' ';
  const bits = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
  return Array.from({ length: rows }, (_, row) => Array.from({ length: width }, (_, column) => {
    let mask = 0, shade = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const glyph = sample(column * 2 + x, row * 4 + y);
      if (glyph !== ' ') { mask |= bits[y]![x]!; shade = Math.max(shade, WEIGHTS.indexOf(glyph)); }
    }
    return { char: mask ? String.fromCodePoint(0x2800 + mask) : ' ', shade };
  }));
}
