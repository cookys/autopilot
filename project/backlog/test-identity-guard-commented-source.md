# test-identity-guard 的 lib_exempt 會匹配被註解掉的 source 行

BL-0419：gitenv g4 的 Minor 發現 fa0cf3e1。lib_exempt regex 也會匹配被註解掉的 source 行，應只匹配程式碼行。
舊的 lib.sh 檢查有同樣的盲點，一併修。負控制：註解掉的 source 行不能讓套件被豁免。
