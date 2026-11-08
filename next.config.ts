import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["comux.test"],
  // 關掉 /_next/image 最佳化端點：comux 沒用到 next/image，留著只是多一個
  // 會抓遠端／解碼圖片（sharp / libvips）的攻擊面
  images: { unoptimized: true },
  // Next 16.4 起 next dev 會自動在 repo 根目錄寫入 AGENTS.md；本專案的 agent 說明
  // 統一放 CLAUDE.md，不要讓 dev server 自己改工作目錄
  agentRules: false,
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
