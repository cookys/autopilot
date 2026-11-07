# dispatch-hetero 的 fingerprint 把 --branch 的 ref 算進去

revival.3d 回報（BL-0416）：fingerprint 把 --branch 指定的那個分支 ref 也算進去，每一輪該分支都會前進，
所以每一輪都判 main_checkout_mutated。
修法：fingerprint 排除 --branch 那個 ref 與它的 reflog；拒收訊息要說出是哪個 ref 變了。
負控制：改動別的 ref 仍要被拒；只動 --branch 的 ref 不被拒。
