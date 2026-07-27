import sharp from 'sharp';
const D='/private/tmp/claude-501/-Users-maedayuto-Desktop-games-bravers-duel/9f53a9a6-39f3-4ec8-b01f-7a68bf402d89/scratchpad';
const ids=['1-A042-SR','1-A107-UC','1-A122-C','1-A077-R'];
for (const st of ['A','B','C']) {
  const W=520,H=347;
  const tiles=await Promise.all(ids.map(id=>sharp(`${D}/test_art/${id}__${st}.webp`).resize(W,H,{fit:'cover'}).toBuffer()));
  await sharp({create:{width:W*2,height:H*2,channels:3,background:'#111'}})
    .composite(tiles.map((input,i)=>({input,left:(i%2)*W,top:Math.floor(i/2)*H})))
    .png().toFile(`${D}/style_${st}.png`);
}
console.log('ok');
