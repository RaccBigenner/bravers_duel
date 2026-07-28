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
const STYLE = argValue('style') ?? 'W3';
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
  // W3: 採用候補。W2 は墨と灰色に寄りすぎて、色が減り分かりにくくなった。
  //     水彩と「密度の偏り」は残したまま、トーンを墨から色へ振り直す。
  //     影も黒ではなく色（青・紫・茶）で作らせるのが肝。
  W3: [
    'Art direction: luminous, colour-rich traditional watercolour illustration on cold-pressed paper.',
    'Layered transparent washes, wet-in-wet bleeds, dragged dry-brush edges and areas of bare white paper —',
    'clearly a painting, never a digital render.',
    'Colour is the point: a full, saturated, luminous palette with several distinct hues in play.',
    'Shadows are coloured — deep blues, violets, warm browns — never neutral grey and never flat black.',
    'This is NOT a monochrome ink wash, NOT sumi-e, NOT a sepia study; avoid an overall grey or desaturated look.',
    "The skill's own element burns brightest — pushed to pure white at its core with its colour flooding out",
    'across every nearby surface — and is set against a complementary colour so that it reads instantly.',
    'Fine ink linework only where it sharpens the focal point, drawn in dark brown or violet rather than black.',
    'Uneven finish for punch: the point of impact carries the crispest edges and the strongest colour contrast,',
    'while everything around it falls away into broad loose washes and bare paper.',
    'Readability first — bold simple silhouettes and clear colour separation.',
    'The picture must be understandable in one second at thumbnail size.',
  ].join(' '),
  // W2: 「密度を偏らせる」で水彩らしさとメリハリは出たが、
  //     墨と灰色に寄って色が消え、かえって分かりにくくなった。不採用
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
// 絵に出す人物は「どこかの騎士」ではなく、第1弾24人の誰か。
// 属性でそのスキルを使えるキャラを cast に書いてあるので、見た目をここで差し込む。
const looks = JSON.parse(readFileSync('tools/character_looks.json', 'utf8'));

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
      'Scope: a single decisive action rather than a landscape event — but it still has to feel powerful.' +
      ' Get the camera in close and let the action fill the frame; cheap does not mean small or quiet.';
  } else {
    scope =
      'Scope: one fast, cheap action. Compensate with proximity and force — right on top of it, filling the frame,' +
      ' with real weight behind it. Never a dainty little vignette.';
  }
  const mood = {
    attack: 'Mood: committed violence at the instant it lands — and it is landing; the target is visibly taking it.',
    guard: isCombat(card)
      ? 'Mood: the block succeeds. The attack shatters or stops dead against the defender, who stays planted, solid and unshaken.' +
        ' Never show the defender knocked down, driven back, cowering or losing.'
      : 'Mood: fast, decisive repositioning — someone getting where they need to be, in control and ahead of the enemy.',
    heal: 'Mood: warm and urgent, and it is working — the wounded one is visibly coming back.',
    support: 'Mood: focused and deliberate rather than violent — the plan clicking into place, everything going right.',
  }[card.valueType];
  // これが抜けていたせいで、ガードのカードなのに「守る側が負けている絵」が出た。
  // プレイヤーが自分で選んで切る札なので、必ず"効いている"絵でなければならない。
  const success =
    "This is the player's own skill going off exactly as intended: it must look effective and under control," +
    ' never like a failure, a defeat or a desperate last stand.' +
    (card.valueType === 'attack'
      ? ' The enemy does not block it — their guard fails and the hit lands.'
      : '');
  // 物理の安いカードが全部「人物が中央でミドルショット」になり、見分けがつかなくなった。
  const framing =
    'Do not fall back on the default of a single figure centred in a mid-shot swinging a weapon.' +
    ' Choose a vantage that suits this particular card — from the target, from the ground, from above,' +
    ' from behind the effect, or close on the thing being destroyed — and let the person sit off-centre,' +
    ' cropped, or out of frame entirely when the effect reads better alone.';
  // 人物と効果を別々に発注すると「剣を差し出した棒立ちの人」＋「無関係な光の輪」になる。
  // 体の動きが効果の原因だと分かる形で繋ぐ。
  const cause = !isCombat(card)
    ? 'The person must visibly be the cause of what is happening — their body is mid-movement, committed and' +
      ' off balance, not posed. But that movement is travel or a gesture, never a strike.'
    : 'If a person causes the effect, their body must visibly be its cause.' +
    ' Catch the action at the end of its follow-through: weight already driven onto the front foot, back heel lifted,' +
    ' hips and shoulders rotated all the way through the movement, cloak and hair still catching up behind.' +
    ' The effect starts at their weapon or hand and traces exactly the path that limb has just travelled.' +
    ' Never draw a figure standing in a neutral stance beside an effect that does not connect to their body.';
  // 規模がどうであれ、画面は毎回殴ってくること。これを外すと絵が眠くなる。
  const force =
    'Whatever the scope, the composition itself must hit hard: the action crosses or breaks the edges of the frame,' +
    ' bodies are caught off balance in mid-movement rather than posed, perspective is steep' +
    (isCombat(card) ? ', and something is coming toward the viewer' : '') +
    '. Never a static, symmetrical, evenly-lit tableau.';
  return `${scope} ${mood} ${success} ${cause} ${force} ${framing}`;
}

/**
 * 魔力の描き込み量を、コストと属性から決める。
 *
 * 「エネルギーを豪華に」を全カードに一律で効かせたら、AP0のひっかき攻撃まで
 * 魔力の大爆発になった。斬・突・打・射・飛・獣・守は生身の技なので、
 * 安いうちは光らせない。
 */
const PHYSICAL = new Set(['斬', '突', '打', '射', '飛', '獣', '守']);

/**
 * 戦闘のカードか、そうでないか。
 * 移動や補給のカードにまで「着弾点の火花」「刃を光らせろ」と書いていたせいで、
 * 飛翔（アクター変更）が剣で斬りかかる絵になった。
 */
function isCombat(card) {
  if (card.valueType === 'attack') return true;
  if (card.valueType === 'guard') return (card.baseValue ?? 0) > 0;
  return false;
}

function energyOf(card) {
  const ap = card.costAp ?? 0;
  const allPhysical = (card.conditionAttribute ?? []).every((a) => PHYSICAL.has(a));
  if (!isCombat(card)) {
    return (
      'Nobody is struck in this picture: no weapon is swung, no blow lands, no wound appears,' +
      ' and no blade or fist glows. The energy in the frame is movement itself —' +
      ' bodies travelling, cloth and hair dragged by speed, dust and grit thrown up,' +
      ' and whatever light the skill itself gives off.'
    );
  }
  if (allPhysical && ap <= 2) {
    // 「魔法にするな」だけ言うと、今度はただの静物になって地味になる。
    // 派手さは魔力ではなく衝撃で出させる。
    return (
      'This is a physical technique, not a spell: no spell-scale magic, nothing that fills the frame with light.' +
      ' But it must never be a bare, effectless study — the force shows as a hard burst at the point of contact:' +
      ' sparks, flying splinters and chips, a shockwave ring in the dust or air, torn air and speed streaks' +
      ' trailing the movement, plus a restrained trace of the wielder\'s own colour glowing along the claw,' +
      ' fist or blade itself.'
    );
  }
  if (ap <= 2) {
    return (
      'Keep the magic modest and contained: a small amount of energy at the hand or weapon and at the point of' +
      ' contact only. It must not fill the frame or light up the whole scene.'
    );
  }
  return (
    'Render the magical energy richly, never as a thin glowing line: build it from layered transparent washes of' +
    ' its own colour, a blown-out white core, granulating pigment along its edges, streamers and motes carried' +
    ' along the flow, secondary sparks thrown off at the impact, faint arcane geometry showing inside the' +
    ' brightest part, and its colour spilling as reflected light onto nearby surfaces and water.'
  );
}

/**
 * 属性ごとの「持ち物と動き」。
 *
 * これを書いていなかったせいで、炎の技でも氷の技でも竜の技でも
 * とりあえず剣を持った人が出てきていた。属性はカードの本体なので、
 * 何を持ち、誰が動くかをここで縛る。
 */
const ATTR_KIT = {
  斬: 'A straight sword and nothing else. The damage is a clean cut. The steel blade itself must be visible as a solid object — never replace it with a glowing beam, laser or bar of light.',
  突: 'A spear or lance and nothing else. The damage is a puncture, never a slash.',
  打: 'A blunt weapon or a bare fist — maul, hammer, club, gauntlet. No blade anywhere.',
  射: 'A bow (or a long-barrelled pistol) that has visibly just been shot. The projectile must be a real arrow or bullet in flight — a solid shaft with fletching, never a beam or bar of light.',
  飛: 'The user is airborne — genuinely off the ground, in flight, wings or leap carrying them through the air. Never standing on the ground.',
  守: 'A shield, used as a shield. The user holds ground.',
  獣: 'The claws, fangs and body of a beast. Absolutely no dragon: this is a feral animal, not a wyrm.',
  竜: 'A dragon does this, not a human with a weapon — either an actual dragon or a dragon-blooded body erupting into draconic form. No sword, no spear.',
  炎: 'Fire, conjured with the hands or a staff. No sword.',
  氷: 'Ice and frost, conjured with the hands or a staff. No sword.',
  雷: 'Lightning, conjured with the hands or a staff. No sword.',
  風: 'Wind, conjured with the hands or a staff. No sword.',
  土: 'Earth and stone, conjured with the hands or by striking the ground. No sword.',
  木: 'Living wood, roots and leaves, conjured with the hands. No sword.',
  聖: 'Holy light, called with open hands, prayer or song. No sword unless the card is also a cutting skill.',
  闇: 'Dark power, called with the hands. No sword unless the card is also a cutting skill.',
  補: 'No weapon at all. Supplies, orders, tools, maps, hands.',
};

function kitOf(card) {
  const attrs = [...new Set(card.conditionAttribute ?? [])];
  const lines = attrs.map((a) => ATTR_KIT[a]).filter(Boolean);
  if (lines.length === 0) return '';
  return (
    `This skill's attributes are ${attrs.join(' + ')}. ${lines.join(' ')}` +
    ' Nothing outside this list may appear in the user\'s hands — do not hand a sword to a spellcaster.'
  );
}

function buildPrompt(card, style = STYLE) {
  const entry = briefs[card.id];
  const brief = entry?.brief;
  if (!brief) throw new Error(`指示書がありません: ${BRIEF_FILE} の ${card.id}`);
  const cast = (entry.cast ?? []).map((name) => {
    if (!looks[name]) throw new Error(`character_looks.json に ${name} がいません（${card.id}）`);
    return looks[name];
  });
  const castLine = cast.length
    ? `The person using this skill is a specific existing character and must be drawn as described: ${cast.join(' ')}` +
      ' Follow this description over any generic wording elsewhere in this prompt.'
    : '';
  return [
    `Illustration for a fantasy card game skill called "${card.name}".`,
    // v2 で落としてしまっていた。これが無いせいで効果を読まずに描かせていた。
    card.effectText
      ? `What the card actually does in the game — the picture must show this happening: ${card.effectText}`
      : '',
    kitOf(card),
    // 絵を見た人が一秒で「誰が・どこで・何をして・どうなったか」を言えること。
    // これが無いと綺麗なだけの模様になる。
    'A viewer must be able to tell at a glance who is doing what, where they are,',
    'and what is happening to the world because of it. Show the cause and its result in the same frame.',
    brief,
    castLine,
    toneOf(card),
    // 「爪は3本なのに爪痕が4本」のような食い違いが出たので、数を必ず合わせさせる。
    'Internal consistency: the number of marks, wounds, projectiles, trails or fragments must exactly match',
    'the number of claws, arrows, blades or hands that produced them. Count them and keep them equal.',
    // 兜を蹴り飛ばしたのに頭にも兜が残っていた事故を防ぐ。
    'Anything knocked away, broken off or destroyed must not also still be in its original place:',
    'a helm struck off leaves a bare head, a shattered shield leaves an empty arm.',
    // 腕が折れる・槍が増える・斬った向きと傷の向きが違う、が多発したので明示する。
    'Anatomy and props must hold up: one body with two arms and one weapon, joints bending the way joints bend,',
    'the attacking limb still attached and plausibly connected to its shoulder.',
    'Never duplicate the weapon into several copies, never leave a spare blade floating in the picture,',
    'and never break a shoulder or elbow to make a pose fit. If a pose would be hard to read, use a simpler one.',
    'Damage must run in the same direction the weapon travelled — the wound lies along the path of the blow.',
    // 顔を裂く絵が出てきたので止める。
    'No gore and no facial wounds: damage reads through broken armour, split shields, staggering bodies and dust.',
    energyOf(card),
    // 世界は西洋ファンタジー。ここを固定しないと和風の城や装束が出てくる。
    'World: Western high fantasy — European medieval stonework, cathedrals, castles, plate and mail armour,',
    'cloaks, straight swords, lances and round or kite shields.',
    'No East Asian architecture, costume, katana, kimono, temple roofs or samurai anywhere in the picture.',
    'Faces stay hidden — turned away, backlit, shadowed or cropped. Never a rendered facial close-up.',
    STYLES[style],
    'Absolutely no text, letters, numbers, logos or watermarks. No card frame, no border.',
    // スイッチで、動きを示す白い矢印記号が画面に描かれてしまった。
    'No diagram graphics of any kind: no drawn arrows, icons, motion symbols, dotted paths or interface marks.',
    'Movement is shown only by the bodies, cloth, dust and debris themselves.',
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

// 何を送っているのか目で確かめるための出力（生成はしない）
if (args.includes('--print-prompt')) {
  for (const card of queue) {
    console.log(`===== ${card.id} ${card.name} =====\n${buildPrompt(card)}\n`);
  }
  process.exit(0);
}

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
