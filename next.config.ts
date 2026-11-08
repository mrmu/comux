import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["comux.test"],
  // 關掉 /_next/image 最佳化端點：comux 沒用到 next/image，留著只是多一個
  // 會抓遠端／解碼圖片（sharp / libvips）的攻擊面
  images: { unoptimized: true },
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
