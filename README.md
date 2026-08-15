# B21 Pro Maintenance System

手機掃描設備 QR Code 後，自動帶入設備資料、以當天作為保養日期、依保養週期計算下次保養日期，並產生 50 × 30 mm B21 Pro 保養標籤。

## QR Code 網址參數

- `id`: 設備編號
- `name`: 設備名稱
- `months`: 保養週期（月）

例如：

`?id=EQ-001&name=真空烤箱&months=1`

## B21 Pro

標籤 Canvas 為 584 × 354 px，目標尺寸 50 × 30 mm / 300 dpi。Web Bluetooth 列印介面使用 niimbluelib，B21 Pro 列印 task 使用 `D110M_V4`。

## 使用方式

部署到 HTTPS 網站後，以支援 Web Bluetooth 的瀏覽器開啟。按「連接 B21 Pro」，選擇印表機，再按「列印保養標籤」。
