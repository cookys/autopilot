# 終端畫面轉 HTML

先擷取含色碼的終端畫面：

```sh
tmux capture-pane -e -p > capture.ans
```

唯一轉換入口：

```sh
node scripts/ansi-to-html-grid.js capture.ans > screen.html
```

請勿使用任何手寫轉換。程式輸出前會檢查三項條件；失敗時不輸出 HTML，訊息寫入標準錯誤，退出碼為第一個失敗項目：

- **3：色碼** — capture 必須含設色 SGR；失敗時用 `tmux capture-pane -e -p` 重新擷取。
- **4：寬度** — 框線右邊界必須對齊，每列 HTML span 寬度總和必須符合獨立計算的顯示寬度。
- **5：色彩 span** — 輸出必須有色彩樣式 span，數量至少為輸入設色 SGR 序列數的一半。

全部通過時退出碼為 0。程式也接受標準輸入。
