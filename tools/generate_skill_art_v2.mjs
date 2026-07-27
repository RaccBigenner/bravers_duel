/**
 * スキルカードのイラスト生成 v2（OpenAI gpt-image-2）
 *
 * v1 の反省:
 *   プロンプトに「包囲された砦」などの例を書いたせいで、108枚すべてが
 *   「城壁 + 土埃の戦場 + 遠くの小さな人影 + 斜めの光の筋」になった。
 *
 * v2 の作り:
 *   構図はモデルに考えさせない。1枚ずつ人が書いた指示書
 *   `tools/skill_art_briefs.json` を読んで、それを絵の中身とする。
 *   このファイルが変われば絵が変わる。プロンプトを直したい時はそこを直す。
 *   絵柄（画材・塗り・線）だけは全108枚で共通にして、画集としての統一感を出す。
 *
 * 使い方:
 *   node tools/generate_skill_art_v2.mjs --ids 1-A039-USR,1-A050-SR   # 小ロット確認用
 *   node tools/generate_skill_art_v2.mjs --all --skip-existing        # 残り全部
 *   node tools/generate_skill_art_v2.mjs --ids ... --out /tmp/xxx     # 差し替えず試す
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY がありません');
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODEL = argValue('model') ?? 'gpt-image-2';
const QUALITY = argValue('quality') ?? 'high';
const STYLE = argValue('style') ?? 'A';
const ONLY_IDS = argValue('ids')?.split(',');
const ALL = args.includes('--all');
const SKIP_EXISTING = args.includes('--skip-existing');
const OUT_DIR = argValue('out') ?? 'assets/card_images';
const MARK_DIR = 'tools/.generated_v2';

// ---------------------------------------------------------------- 絵柄の方向性
// 108枚が「同じ画集から出てきた」と感じる統一感は、この1本だけで担保する。
// 何を描くか（場所・カメラ・光・構図）は指示書側の仕事なので、ここには書かない。
const STYLES = {
  // A: 水彩＋墨。線と面ははっきりしたが、静かになりすぎて派手さが死んだ
  A: [
    'Art direction: Japanese watercolor-and-ink illustration.',
    'Transparent watercolor washes with visible paper grain and hard-edged wet blooms,',
    'over confident dry-brush ink linework. Bold flat color shapes, not airbrushed gradients.',
    'Limited palette per image: two dominant hues plus one accent. Generous untouched paper as negative space.',
  ].join(' '),
  // A2: 派手にはなったが、墨の飛沫と紙目が強すぎて水墨画（＝戦国）に寄り、
  //     細部が潰れて解像度が低く見えた。不採用
  A2: [
    'Art direction: Japanese watercolor-and-ink illustration with the punch of a concert poster.',
    'Transparent watercolor washes on visibly textured paper, but the key light is pushed hard:',
    "one blazing high-chroma accent color — the skill's element — blown out to pure white at its core.",
    'Violent dry-brush ink strokes, flung pigment spatter and flicked droplets carry the motion.',
  ].join(' '),
  // W2: 採用候補。W が「全体を均一に正確に」描かせた結果、
  //     デジタル絵に寄って見どころが消えた。密度を意図的に偏らせるのが肝。
  //     一点だけ描き込み、離れるほど水彩が溶けて紙の白に還る。
  //     これで「水彩らしさ」と「メリハリ」が同時に立つ。
  W2: [
    'Art direction: expressive traditional watercolour on rough cold-pressed paper, with sparing pen-and-ink accents.',
    'This must read unmistakably as a watercolour painting and never as a digital render:',
    'transparent pigment, wet-in-wet bleeds, dragged dry-brush edges, runs, backruns and granulation,',
    'and large areas of bare white paper left completely untouched.',
    'Deliberately uneven finish — this is where the picture gets its punch.',
    'ONE small area, the point of impact, is drawn tight with crisp pen line and full detail;',
    'everything further from it dissolves fast into loose wash, then into bare paper.',
    'Never render the whole frame at an even level of detail.',
    'Extreme value contrast: the darkest near-black wash sits directly against untouched white paper at that focal point.',
    'The brushwork itself carries the movement — long directional strokes and wet streaks trailing the action,',
    'pigment dragged along the line of force.',
    'The palette is greyed and restrained overall so that the single element colour reads as pure and blazing.',
    // 風・土・守のように色を持たない属性だと、この指定だけでは画面が完全にモノクロに落ちる。
    // 必ず有彩色を一点、焦点の近くに置かせる。
    'Even when the skill itself has no colour of its own, the picture must still carry one clear saturated accent —',
    'heraldry on a banner or surcoat, a lantern flame, blood, a strip of sky — placed at or near the focal point.',
    'The whole image must never fall to grey.',
  ].join(' '),
  // W: 線は立ったが全体が均一に描き込まれ、メリハリが死んだ。不採用
  W: [
    'Art direction: traditional Western watercolour and pen-and-ink illustration —',
    'the look of a European fantasy book plate, not of East Asian brush painting.',
    'Fine, controlled pen linework: thin deliberate contour lines that keep every object crisply readable,',
    'with careful cross-hatching for shadow. Clean transparent watercolour washes laid in confident flat shapes.',
    'Only a subtle paper tooth — no heavy grain, no ink spatter, no calligraphic brush strokes, no muddy blooms.',
    'Sharp edges and clean silhouettes; it must look precisely drawn, never like a loose sketch.',
    'The overall colour is restrained and slightly desaturated so that one luminous accent —',
    "the skill's own element, glowing to near-white at its core and casting its colour on nearby surfaces —",
    'carries all of the drama by itself.',
  ].join(' '),
  // B: 不採用。TCG王道のデジタル厚塗り
  B: [
    'Art direction: high-end Japanese digital trading card game illustration.',
    'Painterly cel-shaded anime rendering, thick opaque brushwork, sharp specular highlights,',
    'saturated jewel-tone colors, strong rim light, dense detail in the focal area.',
  ].join(' '),
  // C: 不採用。グアッシュのコンセプトアート
  C: [
    'Art direction: hand-painted gouache concept art for a fantasy game.',
    'Opaque matte paint, chunky visible palette-knife strokes, slightly chalky texture,',
    'muted earthy base palette punched by one intensely saturated accent color.',
  ].join(' '),
};

const BRIEF_FILE = argValue('briefs') ?? 'tools/skill_art_briefs.json';
const SUFFIX = argValue('suffix') ?? '';
const briefs = JSON.parse(readFileSync(BRIEF_FILE, 'utf8'));

/**
 * カードの「話の大きさ」と「温度」を性能から決める。
 *
 * 大事な区別: ここで決めるのは「世界のどれだけが巻き込まれるか」であって、
 * 「絵の勢い」ではない。前のバージョンは安いカードに
 * 「中庭より大きくするな・空に広げるな」と書いてしまい、絵まで大人しくなった。
 * 勢いは常に最大。安いカードは"小さく描く"のではなく"寄って描く"。
 */
function toneOf(card) {
  const ap = card.costAp ?? 0;
  let scope;
  if (card.rarity === 'USR' || ap >= 7) {
    scope = 'Scope: cataclysmic — a landscape-altering event that dwarfs everyone present.';
  } else if (ap >= 5) {
    scope = 'Scope: large — the effect towers over the people and reshapes the ground they stand on.';
  } else if (ap >= 3) {
    scope = 'Scope: a duel — one or two combatants and the ground immediately around them.';
  } else if (ap >= 1) {
    scope =
      'Scope: intimate — one person and one action. Do not shrink the picture to match: move the camera in close so this small act still fills the entire frame.';
  } else {
    scope =
      'Scope: a single small gesture. Get right on top of it — macro close, so that something tiny takes over the whole frame.';
  }
  const mood = {
    attack: 'Mood: committed violence at the instant it lands.',
    guard: 'Mood: bracing under weight — the strain of holding, not the calm of standing.',
    heal: 'Mood: warm and hushed, but urgent; someone is being pulled back from the edge.',
    support: 'Mood: focused and deliberate rather than violent — yet still charged, the light doing the shouting.',
  }[card.valueType];
  // 規模がどうであれ、画面は毎回殴ってくること。これを外すと絵が眠くなる。
  const force =
    'Whatever the scope, the composition itself must hit hard: the action crosses or breaks the edges of the frame,' +
    ' bodies are caught off balance in mid-movement rather than posed, perspective is steep,' +
    ' and something is coming toward the viewer. Never a static, symmetrical, evenly-lit tableau.';
  return `${scope} ${mood} ${force}`;
}

function buildPrompt(card, style = STYLE) {
  const brief = briefs[card.id]?.brief;
  if (!brief) throw new Error(`指示書がありません: ${BRIEF_FILE} の ${card.id}`);
  return [
    `Illustration for a fantasy card game skill called "${card.name}".`,
    // 絵を見た人が一秒で「誰が・どこで・何をして・どうなったか」を言えること。
    // これが無いと綺麗なだけの模様になる。
    'A viewer must be able to tell at a glance who is doing what, where they are,',
    'and what is happening to the world because of it. Show the cause and its result in the same frame.',
    brief,
    toneOf(card),
    // 世界は西洋ファンタジー。ここを固定しないと和風の城や装束が出てくる。
    'World: Western high fantasy — European medieval stonework, cathedrals, castles, plate and mail armour,',
    'cloaks, straight swords, lances and round or kite shields.',
    'No East Asian architecture, costume, katana, kimono, temple roofs or samurai anywhere in the picture.',
    'Faces stay hidden — turned away, backlit, shadowed or cropped. Never a rendered facial close-up.',
    STYLES[style],
    'Absolutely no text, letters, numbers, logos or watermarks. No card frame, no border.',
    'Full-bleed artwork running to all four edges.',
  ].join(' ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 通信エラーや混雑で落ちることがあるので、間隔を空けて数回やり直す */
async function callApi(body, tries = 4) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
      const text = (await res.text()).slice(0, 300);
      // 400番台は何度やっても同じ（プロンプト違反など）ので即あきらめる。429だけは待って再挑戦
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new Error(`API ${res.status}: ${text}`);
      lastError = new Error(`API ${res.status}: ${text}`);
    } catch (e) {
      if (String(e.message).startsWith('API 4')) throw e;
      lastError = e;
    }
    if (attempt < tries) await sleep(attempt * 5000);
  }
  throw lastError;
}

async function generateOne(card) {
  const isUsr = card.rarity === 'USR'; // USRは全面アート（縦長）
  const size = isUsr ? '1024x1536' : '1536x1024';
  const json = await callApi({ model: MODEL, prompt: buildPrompt(card), size, quality: QUALITY, n: 1 });
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像データがありません');

  const png = Buffer.from(b64, 'base64');
  // 縮小しすぎ・圧縮しすぎだと線画が眠くなるので、原寸に近いまま残す
  const width = isUsr ? 896 : 1344;
  const webp = await sharp(png).resize({ width }).webp({ quality: 90 }).toBuffer();
  writeFileSync(`${OUT_DIR}/${card.id}${SUFFIX}.webp`, webp);
  // 確認用に別フォルダへ出した時は「生成済み」印を付けない（--skip-existing が飛ばしてしまうため）
  if (OUT_DIR === 'assets/card_images') writeFileSync(`${MARK_DIR}/${card.id}`, new Date().toISOString());
  return webp.length;
}

// ------------------------------------------------------------------------ 実行
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(MARK_DIR, { recursive: true });
const skills = JSON.parse(readFileSync('data/cards.json', 'utf8')).filter((c) => c.type === 'skill');

let queue = skills;
if (ONLY_IDS) queue = queue.filter((c) => ONLY_IDS.includes(c.id));
else if (!ALL) {
  console.error('--ids か --all を指定してください');
  process.exit(1);
}
if (SKIP_EXISTING) queue = queue.filter((c) => !existsSync(`${MARK_DIR}/${c.id}`));

const CONCURRENCY = Number(argValue('concurrency') ?? 5);
const total = queue.length;
let done = 0;
const failed = [];

async function worker() {
  while (queue.length > 0) {
    const card = queue.shift();
    try {
      const bytes = await generateOne(card);
      done++;
      console.log(`OK ${card.id} ${card.name} (${Math.round(bytes / 1024)}KB) [${done}/${total}]`);
    } catch (e) {
      failed.push(card.id);
      console.error(`NG ${card.id} ${card.name}: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n完了: ${done}枚 / 失敗: ${failed.length}枚 ${failed.join(',')}`);
