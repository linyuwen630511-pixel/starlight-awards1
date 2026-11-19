"""
產生 database.rules.json（Firebase Realtime Database 安全規則）。
免費 Spark 方案：所有投票限制都由安全規則在 Firebase 伺服器端執行，不需 Cloud Functions。
執行：python3 tools/build_rules.py
"""
import json, pathlib

ADMIN = "auth != null && root.child('admins').child(auth.uid).exists()"
EV = "root.child('events').child($eventId)"
ST = f"{EV}.child('status').val()"
R = f"{EV}.child('rules')"
EDITABLE = f"({ST} === 'draft' || {ST} === 'ready' || !{EV}.exists())"


def lockv(expr):
    """核心規則：投票開始後不可修改"""
    return f"{expr} && (!data.exists() || newData.val() === data.val() || {EDITABLE})"


def s(n):
    return f"newData.isString() && newData.val().length <= {n}"


NUM = "newData.isNumber()"

# 投票者身分驗證（$voter 為投票者鍵）
IDENTITY = (
    f"(({R}.child('identity').val() === 'anonymous' && $voter === auth.uid) || "
    f"({R}.child('identity').val() === 'account' && $voter === auth.uid && auth.provider !== 'anonymous' "
    f"&& auth.token.email_verified === true && ({EV}.child('restrictEmails').val() !== true || "
    f"root.child('eligible').child($eventId).child(auth.token.email.replace('.', ',')).exists())) || "
    f"({R}.child('identity').val() === 'code' && root.child('voterCodes').child($eventId).child($voter).exists()))"
)
VOTE_OK = f"auth != null && {ST} === 'open' && {IDENTITY}"

# voterState/$eventId/$voter → 新資料樹的根
VS_ROOT = "newData.parent().parent().parent()"
# ballots/$eventId/$voter/$bid → 新資料樹的根
B_ROOT = "newData.parent().parent().parent().parent()"
DAY_OK = (
    "newData.child('lastDay').isNumber() && newData.child('lastDay').val() % 1 === 0 && "
    "newData.child('lastDay').val() * 86400000 <= now + 28800000 && "
    "now + 28800000 < newData.child('lastDay').val() * 86400000 + 86400000"
)
FREQ_OK = (
    f"(({R}.child('frequency').val() === 'once' && !data.exists()) || "
    f"({R}.child('frequency').val() === 'daily' && (!data.exists() || newData.child('lastDay').val() > data.child('lastDay').val())))"
)
SLOT = f"{EV}.child('slots').child($s)"

rules = {
    "rules": {
        ".read": False,
        ".write": False,
        "admins": {"$uid": {".read": "auth != null && auth.uid === $uid", ".write": False}},
        "codes": {
            "$code": {
                ".read": True,
                ".write": ADMIN,
                ".validate": "$code.matches(/^[A-Z0-9]{6}$/) && newData.isString() && newData.val().length <= 64",
            }
        },
        "events": {
            ".read": ADMIN,
            "$eventId": {
                ".read": "data.exists() && data.child('status').val() !== 'draft'",
                ".write": ADMIN,
                ".validate": "newData.hasChildren(['title','status','rules','timezone','code'])",
                "title": {".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 80"},
                "subtitle": {".validate": s(120)},
                "description": {".validate": s(2000)},
                "date": {".validate": "newData.isString() && (newData.val() === '' || newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/))"},
                "organizer": {".validate": s(80)},
                "coverUrl": {".validate": "newData.isString() && newData.val().length <= 500 && (newData.val() === '' || newData.val().beginsWith('https://') || newData.val().beginsWith('http://'))"},
                "status": {".validate": "newData.isString() && newData.val().matches(/^(draft|ready|open|paused|closed|revealing|completed)$/) && (newData.val() !== 'open' || newData.parent().hasChildren(['slots','lastSlot']))"},
                "timezone": {".validate": "newData.val() === 'Asia/Taipei'"},
                "code": {".validate": "newData.isString() && newData.val().matches(/^[A-Z0-9]{6}$/) && (!data.exists() || newData.val() === data.val())"},
                "createdAt": {".validate": NUM}, "updatedAt": {".validate": NUM},
                "startedAt": {".validate": NUM}, "closedAt": {".validate": NUM},
                "createdBy": {".validate": s(128)},
                "restrictEmails": {".validate": lockv("newData.isBoolean()")},
                "runoffFor": {".validate": s(40)},
                "lastSlot": {".validate": lockv("newData.isString() && newData.val().matches(/^s[0-9]{1,2}$/)")},
                "slots": {
                    ".validate": lockv("newData.hasChild('s0')"),
                    "$s": {".validate": "$s.matches(/^s[0-9]{1,2}$/) && newData.isString() && (newData.val() === '-' || newData.val().matches(/^s[0-9]{1,2}$/))"},
                },
                "rules": {
                    ".validate": "newData.hasChildren(['votesPerVoter','allowRepeat','frequency','mustFill','showcase','identity','tieRule','hidePublicRanking'])",
                    "votesPerVoter": {".validate": lockv("newData.isNumber() && newData.val() >= 1 && newData.val() <= 100 && newData.val() % 1 === 0")},
                    "allowRepeat": {".validate": lockv("newData.isBoolean()")},
                    "frequency": {".validate": lockv("newData.val() === 'once' || newData.val() === 'daily'")},
                    "mustFill": {".validate": lockv("newData.isBoolean()")},
                    "showcase": {".validate": lockv("newData.val() === 'images' || newData.val() === 'none'")},
                    "identity": {".validate": lockv("newData.val() === 'anonymous' || newData.val() === 'code' || newData.val() === 'account'")},
                    "tieRule": {".validate": lockv("newData.val() === 'shared' || newData.val() === 'runoff' || newData.val() === 'judges'")},
                    "hidePublicRanking": {".validate": "newData.val() === true"},
                    "$other": {".validate": False},
                },
                "$other": {".validate": False},
            },
        },
        "candidates": {
            "$eventId": {
                ".read": f"({ADMIN}) || ({EV}.exists() && {ST} !== 'draft')",
                ".write": f"({ADMIN}) && ({EDITABLE} || !newData.exists())",
                "$cid": {
                    ".validate": "newData.hasChildren(['name','order','active'])",
                    "eventId": {".validate": "newData.val() === $eventId"},
                    "code": {".validate": s(12)},
                    "name": {".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 80"},
                    "members": {".validate": s(200)},
                    "workTitle": {".validate": s(120)},
                    "description": {".validate": s(2000)},
                    "order": {".validate": NUM},
                    "active": {".validate": "newData.isBoolean()"},
                    "createdAt": {".validate": NUM}, "updatedAt": {".validate": NUM},
                    "imageUrls": {"$i": {".validate": "$i.matches(/^[0-4]$/) && newData.isString() && newData.val().length <= 1000 && (newData.val().beginsWith('https://') || newData.val().beginsWith('http://') || newData.val().matches(/^db:[-_A-Za-z0-9]{1,40}$/))"}},
                    "sourceId": {".validate": s(40)},
                    "$other": {".validate": False},
                },
            }
        },
        # 投票者狀態：記錄最後投票日與最後一張選票，用來限制「整場一次／每日一次」
        "voterState": {
            "$eventId": {
                ".read": ADMIN,
                "$voter": {
                    ".read": f"({ADMIN}) || (auth != null && (auth.uid === $voter || root.child('voterCodes').child($eventId).child($voter).exists()))",
                    ".write": f"(({ADMIN}) && !newData.exists()) || ({VOTE_OK} && newData.exists())",
                    ".validate": (
                        f"newData.hasChildren(['lastDay','lastBallot','ts']) && {FREQ_OK} && {DAY_OK} && "
                        f"{VS_ROOT}.child('ballots').child($eventId).child($voter).child(newData.child('lastBallot').val()).exists()"
                    ),
                    "lastDay": {".validate": NUM},
                    "lastBallot": {".validate": "newData.isString() && newData.val().length <= 40"},
                    "ts": {".validate": "newData.val() === now"},
                    "$other": {".validate": False},
                },
            }
        },
        # 選票：一般使用者不可讀；只能新增、不可修改或刪除
        "ballots": {
            "$eventId": {
                ".read": ADMIN,
                ".write": f"({ADMIN}) && !newData.exists()",
                "$voter": {
                    "$bid": {
                        ".write": f"!data.exists() && {VOTE_OK} && newData.exists()",
                        ".validate": (
                            f"newData.hasChildren(['dayNum','ts','slots']) && "
                            f"{B_ROOT}.child('voterState').child($eventId).child($voter).child('lastBallot').val() === $bid && "
                            f"{B_ROOT}.child('voterState').child($eventId).child($voter).child('lastDay').val() === newData.child('dayNum').val() && "
                            f"(({R}.child('mustFill').val() === true && newData.child('slots').child({EV}.child('lastSlot').val()).exists()) || ({R}.child('mustFill').val() === false && newData.child('slots').child('s0').exists())) && "
                            f"(({R}.child('allowRepeat').val() === true && !newData.hasChild('picks')) || ({R}.child('allowRepeat').val() === false && newData.hasChild('picks')))"
                        ),
                        "dayNum": {".validate": NUM},
                        "ts": {".validate": "newData.val() === now"},
                        "slots": {
                            "$s": {
                                ".validate": (
                                    f"newData.isString() && {SLOT}.exists() && "
                                    f"({SLOT}.val() === '-' || newData.parent().child({SLOT}.val()).exists()) && "
                                    f"root.child('candidates').child($eventId).child(newData.val()).child('active').val() === true && "
                                    f"({R}.child('allowRepeat').val() === true || newData.parent().parent().child('picks').child(newData.val()).val() === $s)"
                                )
                            }
                        },
                        "picks": {
                            "$cid": {".validate": "newData.isString() && newData.parent().parent().child('slots').child(newData.val()).val() === $cid"}
                        },
                        "$other": {".validate": False},
                    }
                },
            }
        },
        # 一人一碼：只有管理者能讀寫；投票者只能以代碼作為投票鍵
        "voterCodes": {
            "$eventId": {
                ".read": ADMIN,
                ".write": ADMIN,
                "$code": {".validate": "$code.matches(/^[A-Z0-9]{8}$/) && newData.val() === true"},
            }
        },
        # 帳號登入：允許投票的 Email 名單（. 以 , 取代）
        "eligible": {
            "$eventId": {
                ".read": ADMIN,
                ".write": ADMIN,
                "$key": {".validate": "newData.val() === true && $key.length <= 200"},
            }
        },
        # 作品圖片（免費方案：壓縮後存於資料庫）
        "images": {
            "$eventId": {
                ".read": f"({ADMIN}) || ({EV}.exists() && {ST} !== 'draft')",
                ".write": f"({ADMIN}) && ({EDITABLE} || !newData.exists())",
                "$cid": {
                    "$img": {
                        ".validate": "newData.hasChildren(['full','thumb'])",
                        "full": {".validate": "newData.isString() && newData.val().beginsWith('data:image/') && newData.val().length <= 420000"},
                        "thumb": {".validate": "newData.isString() && newData.val().beginsWith('data:image/') && newData.val().length <= 90000"},
                        "w": {".validate": NUM}, "h": {".validate": NUM},
                        "$other": {".validate": False},
                    }
                },
            }
        },
        # 同票處理資料（評審分數／加賽票數）
        "tiebreak": {"$eventId": {".read": ADMIN, ".write": ADMIN}},
        "results": {"$eventId": {".read": ADMIN, ".write": ADMIN}},
        "awards": {"$eventId": {".read": ADMIN, ".write": ADMIN}},
    }
}

out = pathlib.Path(__file__).resolve().parent.parent / "database.rules.json"
out.write_text(json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8")
print("written", out)
