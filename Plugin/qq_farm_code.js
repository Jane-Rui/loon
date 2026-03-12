/**
 * 适配 Loon 的 QQ农场 Code 提取脚本
 */

const url = $request.url;

if (url.includes("code=")) {
    // 使用正则精确匹配 code 值
    const codeMatch = url.match(/code=([^&]+)/);
    const code = codeMatch ? codeMatch[1] : null;

    if (code) {
        console.log("🎯 成功获取 QQ农场 code: " + code);
        
        // 1. 写入持久化存储
        $persistentStore.write(code, "qq_farm_code");
        
        // 2. 自动复制到剪贴板 (Loon 专用 API)
        if (typeof $copy !== "undefined") {
            $copy(code);
            var copyStatus = "并已自动复制";
        } else {
            var copyStatus = "请手动前往存储查看";
        }
        
        // 3. 发送系统通知
        $notification.post(
            "🚜 QQ农场 Code 提取成功", 
            "当前 Code: " + code, 
            "数据已保存至存储" + copyStatus
        );
    }
}

// 必须执行 $done 确保网络请求不被挂起
$done({});
