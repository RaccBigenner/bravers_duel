/**
 * スキルカードのイラストを OpenAI gpt-image-1 で生成し直すスクリプト。
 *
 * 使い方:
 *   node tools/generate_skill_art.mjs --ids 1-A068-R,1-A066-R      # 指定カードだけ
 *   node tools/generate_skill_art.mjs --all                        # スキル108枚すべて
 *   node tools/generate_skill_art.mjs --all --quality high         # 高品質（コスト増）
 *   node tools/generate_skill_art.mjs --all --skip-existing        # 生成済み(.new印)をスキップ
 *
 * 方針（社長指示）:
 * - 今の構図・画像は一切参照しない。カード名・性能から想像した画像
 * - キャラクターではなくアクション・エフェクトにフォーカス
 * - 水彩アニメ調
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
const QUALITY = argValue('quality') ?? 'medium';
const ONLY_IDS = argValue('ids')?.split(',');
const ALL = args.includes('--all');
const SKIP_EXISTING = args.includes('--skip-existing');

const OUT_DIR = 'assets/card_images';
const MARK_DIR = 'tools/.generated'; // 生成済み記録（再開用）
mkdirSync(MARK_DIR, { recursive: true });

const cards = JSON.parse(readFileSync('data/cards.json', 'utf8'));
let skills = cards.filter((c) => c.type === 'skill');
if (ONLY_IDS) skills = skills.filter((c) => ONLY_IDS.includes(c.id));
else if (!ALL) {
  console.error('--ids か --all を指定してください');
  process.exit(1);
}

// 属性 → 画像モチーフの対訳
const ATTR_MOTIF = {
  斬: 'sword slash arcs, blade streaks',
  突: 'piercing lance thrust, spear lines',
  打: 'crushing impact, shockwave rings',
  射: 'arrows in flight, bow shot trails',
  飛: 'wind-borne flight, feathers and air streams',
  炎: 'blazing flames, embers',
  氷: 'ice crystals, frost shards, cold mist',
  雷: 'lightning bolts, electric sparks',
  風: 'swirling wind, gale spirals',
  土: 'earth and rock, dust bursts',
  木: 'growing vines, leaves and roots',
  聖: 'holy golden light, radiant glow',
  闇: 'dark violet miasma, shadow tendrils',
  竜: 'draconic energy, dragon-shaped aura',
  獣: 'feral claw marks, beastly afterimages',
  補: 'supportive glowing runes, gentle light motes',
  守: 'protective barrier, shield of light',
};

// スキル種 → 構図の方向性
const TYPE_MOOD = {
  attack: 'an offensive burst striking toward the viewer side, dynamic diagonal composition, sense of impact',
  guard: 'a defensive barrier or shield effect blooming outward, protective and solid, centered composition',
  support: 'a tactical, uplifting magical phenomenon, calm but wondrous, flowing composition',
  heal: 'a gentle restorative light falling softly, warm and serene, soft glow composition',
};

function buildPrompt(card) {
  const motifs = [...new Set(card.conditionAttribute)].map((a) => ATTR_MOTIF[a]).filter(Boolean);
  const motifText = motifs.length > 0 ? motifs.join('; ') : 'pure arcane energy';
  const story = card.flavorText
    ? `Story seed (use its mood as inspiration): 「${card.flavorText}」.`
    : 'Invent a story moment that fits the skill name: where is this happening, who needed this power, what is at stake.';
  return [
    `Fantasy trading card game skill art for a skill named "${card.name}".`,
    `Skill meaning: ${card.effectText || 'a straightforward powerful technique'}.`,
    `Depict the ACTION and EFFECT itself: ${TYPE_MOOD[card.valueType]}.`,
    `Visual motifs: ${motifText}.`,
    story,
    'Compose it as one dramatic moment of a larger story: cinematic staging with environmental storytelling — a real place (besieged fortress, scorched battlefield, ancient ruins, deep forest, storm-lit sky...), weather, time of day, traces of what just happened. The viewer should feel why this skill was unleashed.',
    'Small distant figures or silhouettes ARE welcome to carry the story, but the skill effect remains the hero of the image. No close-up faces.',
    'Modern watercolor anime style: translucent watercolor washes, soft color bleeding, crisp anime-style effect lines and highlights, luminous colors, painterly texture.',
    'No text, no letters, no logos, no card frame, no border.',
    'Full-bleed background artwork.',
  ].join(' ');
}

async function generateOne(card) {
  const isUsr = card.rarity === 'USR'; // USRは全面アート（縦長）
  const size = isUsr ? '1024x1536' : '1536x1024';
  const prompt = buildPrompt(card);

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, quality: QUALITY, n: 1 }),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('画像データがありません');

  const png = Buffer.from(b64, 'base64');
  const width = isUsr ? 768 : 1152; // 表示に十分なサイズへ縮小してwebp化
  const webp = await sharp(png).resize({ width }).webp({ quality: 82 }).toBuffer();
  writeFileSync(`${OUT_DIR}/${card.id}.webp`, webp);
  writeFileSync(`${MARK_DIR}/${card.id}`, new Date().toISOString());
  return webp.length;
}

const CONCURRENCY = Number(argValue('concurrency') ?? 4);
const queue = skills.filter((c) => !(SKIP_EXISTING && existsSync(`${MARK_DIR}/${c.id}`)));
const total = queue.length;
let done = 0;
let failed = [];

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
console.log(`\n完了: ${done}枚生成 / 失敗: ${failed.length}枚 ${failed.join(',')}`);
