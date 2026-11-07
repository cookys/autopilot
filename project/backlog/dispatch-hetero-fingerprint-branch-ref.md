# dispatch-hetero 每輪被判 main_checkout_mutated（BL-0416）

revival.3d 回報（BL-0416）：每一輪 dispatch-hetero 都以 main_checkout_mutated 拒收。
原推測是「fingerprint 把 --branch 指定的那個分支 ref 也算進去，該分支每輪都會前進」。

## 推測已被實測推翻
- scripts/lib/main-checkout-boundary.sh 的 `main_checkout_fingerprint`（錨點 `awk -v own="refs/heads/${BRANCH}="`）本來就把本次派工自己的分支排除在外。
- 檔頭註解（錨點 `(refs/replace included) except the ones the caller declares`）列出量測範圍；reflog 不在其中，所以「連 reflog 一起算」的說法也不成立。
- 因此原報告的成因不成立；真正讓指紋每輪變動的原因目前未知。

## 已做
- hetfp：拒收訊息現在列出變動的指紋元件，以及每個被新增、移除或移動的 ref 與前後 sha，不再只有兩個雜湊。

## 下一步
- 等 revival.3d 下次被拒時，把新的拒收訊息貼回來（PM 已請 game-lead 轉達），再依訊息列出的元件與 ref 判斷成因。
- 在那之前這一列維持 open，不動指紋邏輯。
- 負控制仍適用：改動別的 ref 要被拒；只動自己的分支不被拒。
