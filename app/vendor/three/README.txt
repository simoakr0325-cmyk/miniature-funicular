three.js r180 (0.180.0, MIT) — https://threejs.org/
build/three.module.min.js, build/three.core.min.js, examples/jsm/controls/OrbitControls.js をそのまま置いた。
OrbitControls.js だけ、import 元の 'three' を './three.module.min.js' に書き換えている（ビルドなしで読めるように）。
