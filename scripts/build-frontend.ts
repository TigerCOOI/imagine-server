import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const TEMP_DIR = path.join(rootDir, `peinture-build-${Date.now()}`);
const FRONTEND_REPO = "https://github.com/Amery2010/peinture.git";
const PUBLIC_DIR = path.join(rootDir, "public");

console.log("🚀 开始构建前端...");

// 清理旧的 public 目录
if (fs.existsSync(PUBLIC_DIR)) {
  console.log("📦 清理旧的 public 目录...");
  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
}

try {
  // 克隆项目
  console.log("📥 克隆 peinture 项目...");
  execSync(`git clone ${FRONTEND_REPO} ${TEMP_DIR}`, { stdio: "inherit" });

  // 安装依赖 (尝试使用跨平台可用方式)
  console.log("📦 安装依赖...");
  try {
    execSync("npm install", { cwd: TEMP_DIR, stdio: "inherit" });
  } catch (err) {
    console.log("npm 不存在，尝试使用 pnpm...");
    execSync("pnpm install", { cwd: TEMP_DIR, stdio: "inherit" });
  }

  // 修改 vite.config.ts 添加 SERVICE_MODE 定义
  console.log("⚙️ 配置服务器模式...");
  const viteConfigContent = `import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.VITE_SERVICE_MODE': JSON.stringify(env.VITE_SERVICE_MODE || 'local')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
`;
  fs.writeFileSync(path.join(TEMP_DIR, "vite.config.ts"), viteConfigContent);
  // 注入默认 S3 配置到 Peinture 前端
  console.log(" 注入默认 S3 配置...");
  const storageServicePath = path.join(TEMP_DIR, "services", "storageService.ts");
  let storageServiceContent = fs.readFileSync(storageServicePath, "utf8");
  
  const defaultS3Config = {
    accessKeyId: process.env.VITE_DEFAULT_S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.VITE_DEFAULT_S3_SECRET_ACCESS_KEY || "",
    bucket: process.env.VITE_DEFAULT_S3_BUCKET_NAME || "",
    region: process.env.VITE_DEFAULT_S3_REGION || "auto",
    endpoint: process.env.VITE_DEFAULT_S3_ENDPOINT || "",
    publicDomain: process.env.VITE_DEFAULT_S3_PUBLIC_DOMAIN || "",
    prefix: process.env.VITE_DEFAULT_S3_PREFIX || "peinture/",
  };
  console.log(" 默认 S3 配置检查:", {
    endpoint: defaultS3Config.endpoint,
    bucket: defaultS3Config.bucket,
    region: defaultS3Config.region,
    publicDomain: defaultS3Config.publicDomain,
    prefix: defaultS3Config.prefix,
    accessKeyIdExists: !!defaultS3Config.accessKeyId,
    secretAccessKeyExists: !!defaultS3Config.secretAccessKey,
  });
  storageServiceContent = storageServiceContent.replace(
    /export const DEFAULT_S3_CONFIG: S3Config = \{[\s\S]*?\};/,
    `export const DEFAULT_S3_CONFIG: S3Config = ${JSON.stringify(defaultS3Config, null, 2)};`
  );
  fs.writeFileSync(storageServicePath, storageServiceContent);
  // 登录 / 输入 API Token 后，自动切换到 S3
  console.log(" 注入登录后自动切换 S3 逻辑...");
  const configStorePath = path.join(TEMP_DIR, "store", "configStore.ts");
  let configStoreContent = fs.readFileSync(configStorePath, "utf8");
  configStoreContent = configStoreContent.replace(
    /setProviderTokens:\s*\(providerId,\s*tokenString\)\s*=>\s*\{[\s\S]*?set\(\(state\)\s*=>\s*\(\{\s*tokens:\s*\{\s*\.\.\.state\.tokens,\s*\[providerId\]:\s*list,\s*\},\s*\}\)\);\s*\},/,
    `setProviderTokens: (providerId, tokenString) => {
      const list = tokenString
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      set((state) => {
        const nextState: any = {
          tokens: {
            ...state.tokens,
            [providerId]: list,
          },
        };
        // 只要用户输入了任意 API Token，就自动切换到默认 S3
        if (list.length > 0) {
          nextState.storageType = "s3";
          nextState.s3Config = DEFAULT_S3_CONFIG;
        }
        return nextState;
        });
    },`
  );

fs.writeFileSync(configStorePath, configStoreContent);

  // 构建项目（注入服务器模式环境变量）
  console.log("🔨 构建项目（服务器模式）...");
  const buildEnv = { ...process.env, VITE_SERVICE_MODE: "server" };
  try {
    execSync("npm run build", {
      cwd: TEMP_DIR,
      env: buildEnv,
      stdio: "inherit",
    });
  } catch (err: any) {
    execSync("pnpm run build", {
      cwd: TEMP_DIR,
      env: buildEnv,
      stdio: "inherit",
    });
  }

  // 复制构建产物
  console.log("📋 复制构建产物到 public 目录...");
  fs.cpSync(path.join(TEMP_DIR, "dist"), PUBLIC_DIR, { recursive: true });

  console.log("✅ 前端构建完成！");
  console.log(`📁 静态文件已复制到: ${PUBLIC_DIR}`);
} catch (error) {
  console.error("❌ 构建过程中发生错误:", error);
  process.exit(1);
} finally {
  // 清理临时目录
  if (fs.existsSync(TEMP_DIR)) {
    console.log("🧹 清理临时文件...");
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}
