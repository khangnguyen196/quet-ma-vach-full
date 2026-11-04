import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// basicSsl tạo chứng chỉ HTTPS tự ký để mở camera khi test trên điện thoại.
// host: true để điện thoại cùng Wi-Fi vào được bằng IP máy tính.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 }
});
