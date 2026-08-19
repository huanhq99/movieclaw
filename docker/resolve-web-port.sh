#!/bin/sh
# =============================================================================
# 对外端口的唯一解析入口：entrypoint 与 Docker HEALTHCHECK 共用。
#
# 两者必须解析出同一个端口——健康检查探的就是前端实际监听的那个口，各自算
# 各自的话，用户一改端口容器就会被判成 unhealthy 并被反复重启。
#
# 优先级（高 → 低）：
#   1. 端口文件（$MOVIECLAW_WEB_PORT_FILE，默认 /app/data/config/web-port）
#      —— 「设置 → 应用设置」写入，落在 data 卷上，容器重建不丢
#   2. 环境变量 $MOVIECLAW_WEB_PORT —— compose/run 里配，适合部署时一次定死
#   3. 默认 3000
#
# 为什么端口文件是事实源、而不是像其它设置那样落数据库：这个值的消费者是本
# 脚本和 entrypoint 两个**不读数据库**的 shell；而且新端口起不来时 entrypoint
# 必须能就地把它废掉并回落（见 entrypoint 的 reject_web_port），数据库里再存
# 一份必然出现两套真相。后端设置接口因此也直接读写这个文件。
#
# 非法值（非数字、越界）一律降级到下一优先级并在 stderr 留一行中文警告：
# 端口配错是用户手滑，不该让整个容器起不来。
#
# 输出一行：`<端口> <来源>`，来源 ∈ setting | env | default
# =============================================================================
set -eu

WEB_PORT_FILE="${MOVIECLAW_WEB_PORT_FILE:-/app/data/config/web-port}"
DEFAULT_WEB_PORT=3000

# 纯 sh 的端口校验：先卡长度再比大小，避免超长数字串在 [ -ge ] 里溢出
is_valid_port() {
    case "$1" in
        '' | *[!0-9]*) return 1 ;;
    esac
    [ "${#1}" -le 5 ] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

if [ -f "$WEB_PORT_FILE" ]; then
    from_file="$(tr -d '[:space:]' < "$WEB_PORT_FILE" 2>/dev/null || true)"
    if is_valid_port "$from_file"; then
        echo "$from_file setting"
        exit 0
    fi
    if [ -n "$from_file" ]; then
        echo "[resolve-web-port] 端口文件内容非法（${from_file}），已忽略：$WEB_PORT_FILE" >&2
    fi
fi

if [ -n "${MOVIECLAW_WEB_PORT:-}" ]; then
    if is_valid_port "$MOVIECLAW_WEB_PORT"; then
        echo "$MOVIECLAW_WEB_PORT env"
        exit 0
    fi
    echo "[resolve-web-port] 环境变量 MOVIECLAW_WEB_PORT 非法（${MOVIECLAW_WEB_PORT}），已忽略" >&2
fi

echo "$DEFAULT_WEB_PORT default"
