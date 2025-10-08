const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Wallet } = require('ethers');
const fetch = require('node-fetch');
const ora = require('ora');
// const cfonts = require('cfonts'); // 不再需要
const { HttpsProxyAgent } = require('https-proxy-agent');

// 配置常量
const API_BASE = 'https://networkapi-2snbrq2o3a-ue.a.run.app';
const WALLET_FILE = path.join(__dirname, 'wallets.json');
const PROXY_FILE = path.join(__dirname, 'proxy.txt');
const DEBUG = process.argv.includes('--debug') || process.argv.includes('-d');

// 默认请求头
const DEFAULT_HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6,fr;q=0.5,ru;q=0.4,und;q=0.3',
    'content-type': 'application/json',
    'dnt': '1',
    'origin': 'https://app.whitebridge.network',
    'priority': 'u=1, i',
    'referer': 'https://app.whitebridge.network/',
    'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'x-firebase-appcheck': 'eyJraWQiOiJVTjJhMmciLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxOjcxMjg5NzE5NTE2MDp3ZWI6OWE4ODRhODY1ZDk2ZThhMWFjNzRlZCIsImF1ZCI6WyJwcm9qZWN0cy83MTI4OTcxOTUxNjAiLCJwcm9qZWN0cy9sZWFrZWQtYWkiXSwicHJvdmlkZXIiOiJyZWNhcHRjaGFfZW50ZXJwcmlzZSIsImlzcyI6Imh0dHBzOi8vZmlyZWJhc2VhcHBjaGVjay5nb29nbGVhcGlzLmNvbS83MTI4OTcxOTUxNjAiLCJleHAiOjE3NTk4ODc5OTQsImlhdCI6MTc1OTg4NDM5NCwianRpIjoiMkpNN1BLR0dxUkUwNkdId0ZHbkxsTDNtZFo3b0NPa1NnVG5LU3Zzbl9oYyJ9.VheCP9tUTeONQ1krLQft5es2KwU93U_ymTNOwgVWqHL_NZXxKpkDEgkfZkGX7HndVhtrGjLv-eszOyV7PgajSi5WhJPwOGPdEsWDmgC30PmWzFEXqNti2MW4B3_idwWGrEbUw7UxE28IpNRytb_3z35IAafx_8D1N5ozAUoKPzfi_kpwbyKMUyxNF6l6UTcMX9eYFQws9mRkRc9JItTt7syZUWBDGtnZ0pIMGrsLQ6kNr494C830-6u01e-JISEX_MuDMMSCetXTAs6IRCGSyli5H9eH7aoKJFnZwxlzB-bRObRQLUicAslbXNvmKXhTXFI9x4kNAyKTjAhNE6uKoZPwHqmy2RZ7WJbeI320IvuXERdQhpXRAicyop5NZGvv9eTXjeiKLFWvJtxQqkwSns7b8NuhaUqnsAS2rpL6bSeNuWOR4-LIEewUlTWYzPEGjTpc12ZPvcfLkxnQbbhLP24NvY71MYz9gTG7CNjG2O7OXU9miV4T4jaR_ebS1_Ey'
};

// 全局变量
let proxies = [];
let proxyIndex = 0;

// 加载代理列表
function loadProxies() {
    try {
        const proxyContent = fs.readFileSync(PROXY_FILE, 'utf8');
        const proxyList = proxyContent.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        
        proxies = proxyList;
        proxyIndex = 0;
        
        if (proxies.length > 0) {
            console.log('✅ 已加载 ' + proxies.length + ' 个代理服务器');
        } else {
            console.log('⚠️  未找到代理服务器，将直接连接');
        }
    } catch (error) {
        proxies = [];
        console.log('⚠️  proxy.txt 文件未找到，将直接连接');
    }
}

// 获取下一个代理代理
function getNextAgent() {
    if (!proxies || proxies.length === 0) return null;
    
    const proxyUrl = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    
    try {
        return new HttpsProxyAgent(proxyUrl);
    } catch (error) {
        console.warn('⚠️  无效的代理地址，跳过:', proxyUrl);
        return null;
    }
}

// 加载钱包列表
function loadWallets() {
    try {
        const walletContent = fs.readFileSync(WALLET_FILE, 'utf8');
        return JSON.parse(walletContent || '[]');
    } catch (error) {
        return [];
    }
}

// 保存钱包列表
function saveWallets(wallets) {
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
}

// 添加钱包到列表
function appendWallet(wallet) {
    const wallets = loadWallets();
    wallets.push(wallet);
    saveWallets(wallets);
}

// 询问用户输入
function askQuestion(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

// 发送POST JSON请求
async function postJson(url, data = {}, headers = {}) {
    const agent = getNextAgent();
    const requestOptions = {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, ...headers },
        body: JSON.stringify(data),
        timeout: 30000
    };
    
    if (agent) {
        requestOptions.agent = agent;
    }
    
    const response = await fetch(url, requestOptions);
    const responseText = await response.text();
    
    let jsonData = null;
    try {
        jsonData = JSON.parse(responseText);
    } catch (error) {
        // 忽略JSON解析错误
    }
    
    return {
        status: response.status,
        json: jsonData,
        raw: responseText
    };
}

// 提取随机数
function extractNonce(response) {
    if (!response) return null;
    
    // 如果是字符串且长度>=6，直接返回
    if (typeof response === 'string') {
        if (response.length >= 6) return response;
        return null;
    }
    
    // 尝试从不同字段提取nonce
    if (response.nonce) return response.nonce;
    if (response.data && response.data.nonce) return response.data.nonce;
    if (response.result && response.result.nonce) return response.result.nonce;
    
    // 遍历所有字段寻找可能的nonce
    for (const key of Object.keys(response)) {
        if (typeof response[key] === 'string' && response[key].length >= 6) {
            return response[key];
        }
    }
    
    return null;
}

// 提取访问令牌
function extractToken(response) {
    if (!response) return null;
    if (typeof response === 'string') return null;
    
    // 尝试从不同字段提取token
    if (response.token) return response.token;
    if (response.accessToken) return response.accessToken;
    if (response.data && (response.data.token || response.data.accessToken)) {
        return response.data.token || response.data.accessToken;
    }
    if (response.result && (response.result.token || response.result.access_token)) {
        return response.result.token || response.result.access_token;
    }
    if (response.access_token) return response.access_token;
    if (response.data && response.data.jwt) return response.data.jwt;
    
    return null;
}

// 脱敏显示敏感信息
function redact(text) {
    if (!text || typeof text !== 'string') return '(no token)';
    
    if (text.length <= 12) {
        return text.slice(0, 6) + '...';
    }
    
    return text.slice(0, 8) + '...' + text.slice(-4);
}

// 生成签名消息
function makeSignMessage({ address, nonce, issuedAtIso }) {
    return `app.whitebridge.network wants you to sign in with your Ethereum account:
${address}

Sign this message to connect with app.whitebridge.network.

URI: https://app.whitebridge.network
Version: 1
Chain ID: 56
Nonce: ${nonce}

Issued At: ${issuedAtIso}`;
}

// 主函数
(async () => {
    try {
        // 显示简单的启动信息
        console.log('🚀 WhiteBridge 脚本启动中...');
        console.log('📢 Dandan脚本: https://t.me/sands0x1');
        
        // 加载代理
        loadProxies();
        
        // 询问循环次数
        let loopCount = parseInt((await askQuestion('请输入循环次数: ')).trim(), 10);
        if (isNaN(loopCount) || loopCount <= 0) {
            loopCount = 1;
        }
        
        // 询问推荐码
        let referralCode = (await askQuestion('请输入推荐码: ')).trim();
        if (!referralCode) {
            referralCode = 'test';
        }
        
        console.log('');
        
        // 开始处理
        const mainSpinner = ora('开始执行 ' + loopCount + ' 次循环 — 推荐码: ' + referralCode).start();
        let successCount = 0;
        
        for (let i = 1; i <= loopCount; i++) {
            const currentLoop = 'Loop ' + i + '/' + loopCount;
            const walletSpinner = ora(currentLoop + ': 正在生成钱包').start();
            
            // 生成钱包
            const wallet = Wallet.createRandom();
            
            try {
                appendWallet({
                    address: wallet.address,
                    privateKey: wallet.privateKey,
                    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
                    createdAt: new Date().toISOString()
                });
                
                walletSpinner.succeed(currentLoop + ': 钱包已创建 — ' + wallet.address + ' (已保存)');
            } catch (error) {
                walletSpinner.fail(currentLoop + ': 钱包保存失败: ' + (error.message || error));
                continue;
            }
            
            // 请求随机数
            const nonceSpinner = ora(currentLoop + ': 正在请求随机数').start();
            let nonce;
            
            try {
                const nonceResponse = await postJson(API_BASE + '/wallet/nonce', {
                    address: wallet.address
                });
                
                const nonceData = nonceResponse.json || nonceResponse.raw;
                nonce = extractNonce(nonceData);
                
                if (nonce) {
                    nonceSpinner.succeed(currentLoop + ': 随机数已获取 — ' + String(nonce).slice(0, 12) + '...');
                } else {
                    nonceSpinner.fail(currentLoop + ': 无法提取随机数 (状态码 ' + nonceResponse.status + ')');
                    console.log('🐛 调试信息 - 随机数响应:', nonceResponse);
                    continue;
                }
            } catch (error) {
                nonceSpinner.fail(currentLoop + ': 随机数请求失败: ' + (error.message || error));
                continue;
            }
            
            // 签名消息
            const signSpinner = ora(currentLoop + ': 正在签名消息').start();
            let signature, messageToSign;
            
            try {
                const issuedAt = new Date().toISOString();
                messageToSign = makeSignMessage({
                    address: wallet.address,
                    nonce: nonce,
                    issuedAtIso: issuedAt
                });
                
                signature = await wallet.signMessage(messageToSign);
                signSpinner.succeed(currentLoop + ': 消息已签名');
            } catch (error) {
                signSpinner.fail(currentLoop + ': 签名失败: ' + (error.message || error));
                continue;
            }
            
            // 登录
            const signinSpinner = ora(currentLoop + ': 正在登录').start();
            let accessToken;
            
            try {
                const signinResponse = await postJson(API_BASE + '/wallet/signin', {
                    address: wallet.address,
                    message: messageToSign,
                    signature: signature
                });
                
                if (DEBUG) {
                    console.log('\n🐛 调试信息 - 登录响应 (' + currentLoop + '): 状态码=' + signinResponse.status);
                    console.log('\n🐛 调试信息 - 登录JSON:', JSON.stringify(signinResponse.json, null, 2));
                    console.log('\n🐛 调试信息 - 登录原始响应:', signinResponse.raw, '\n');
                }
                
                accessToken = extractToken(signinResponse.json || signinResponse.raw);
                
                if (accessToken) {
                    signinSpinner.succeed(currentLoop + ': 登录成功 — 令牌 ' + redact(accessToken));
                } else {
                    signinSpinner.fail(currentLoop + ': 登录失败 (未获取到令牌)');
                    console.log('🐛 调试信息 - 登录响应:', signinResponse);
                    continue;
                }
            } catch (error) {
                signinSpinner.fail(currentLoop + ': 登录错误: ' + (error.message || error));
                continue;
            }
            
            // 领取推荐奖励
            const claimSpinner = ora(currentLoop + ': 正在领取推荐奖励').start();
            
            try {
                const claimResponse = await postJson(API_BASE + '/referral/claim', {
                    referralCode: referralCode
                }, {
                    'Authorization': 'Bearer ' + accessToken
                });
                
                if (DEBUG) {
                    console.log('\n🐛 调试信息 - 领取响应 (' + currentLoop + '): 状态码=' + claimResponse.status);
                    console.log('🐛 调试信息 - 领取JSON:', JSON.stringify(claimResponse.json, null, 2));
                    console.log('🐛 调试信息 - 领取原始响应:', claimResponse.raw, '\n');
                }
                
                const responseData = claimResponse.json || claimResponse.raw || '';
                const isSuccess = claimResponse.json && (
                    claimResponse.json.success || 
                    claimResponse.json.status === 'ok'
                ) || (
                    typeof responseData === 'string' && 
                    /success|ok|claimed/i.test(responseData)
                );
                
                if (claimResponse.status >= 200 && claimResponse.status < 300 && isSuccess) {
                    claimSpinner.succeed(currentLoop + ': 推荐奖励领取成功');
                    successCount++;
                } else if (claimResponse.status >= 200 && claimResponse.status < 300) {
                    claimSpinner.warn(currentLoop + ': 推荐奖励领取失败 (状态码 ' + claimResponse.status + ')');
                } else {
                    claimSpinner.fail(currentLoop + ': 推荐奖励领取失败 (状态码 ' + claimResponse.status + ')');
                }
            } catch (error) {
                claimSpinner.fail(currentLoop + ': 推荐奖励领取错误: ' + (error.message || error));
            }
            
            // 等待一段时间
            await new Promise(resolve => setTimeout(resolve, 400));
        }
        
        mainSpinner.succeed('✅ 已完成 ' + loopCount + ' 次循环。成功领取: ' + successCount + ' 次');
        console.log('📁 请查看 ' + path.basename(WALLET_FILE) + ' 文件中的钱包信息。');
        
    } catch (error) {
        ora().fail('❌ 致命错误: ' + (error && error.message ? error.message : error));
        process.exit(1);
    }
})();
