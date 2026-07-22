#ifdef GL_ES
precision mediump float;
#endif

// Flutter から渡される uniform
uniform float u_time;         // 経過秒
uniform vec2  u_resolution;   // 画面サイズ(px)

// 疑似乱数
float rand(float x) {
  return fract(sin(x)*43758.5453123);
}

void main() {
  // 正規化座標 (0,0) から (1,1)
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // 中心点
  vec2 center = vec2(0.5, 0.5);

  // 背景色（暗め）
  vec3 col = vec3(0.01, 0.01, 0.02);

  const int NUM = 8;  // 粒子数
  for (int i = 0; i < NUM; i++) {
    float fi = float(i);

    // 各粒子ごとに乱数ベースの初期角度
    float seed = rand(fi * 12.345);
    float angle = seed * 6.2831853 + u_time * 0.6; 

    // 拡散スピード：時間と乱数を混ぜ合わせ
    float speed = mod(u_time * 0.2 + seed, 1.0);

    // 粒子位置
    vec2 pos = center + vec2(cos(angle), sin(angle)) * speed;

    // 画素と粒子中心の距離
    float d = length(uv - pos);

    // 半径とフェード幅
    float radius = 0.015;
    float fade   = 0.01;

    // Gaussian ライクなフェードアウト
    float intensity = exp(-pow(d / radius, 2.0)) * smoothstep(radius + fade, radius, d);

    // 粒子色（カスタマイズ可）
    col += vec3(1.0, 0.8, 0.4) * intensity;
  }

  gl_FragColor = vec4(col, 1.0);
}
