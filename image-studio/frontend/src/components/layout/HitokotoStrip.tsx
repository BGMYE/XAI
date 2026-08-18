import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

// 本地句库 —— 25 句网易云伤感文案 + 古诗短句混搭。
// 不联网请求,避免被防火墙/代理挡掉。
const QUOTES: { text: string; from: string }[] = [
  { text: "山有顶峰,湖有彼岸;在人生漫漫长途中,万物皆有回转。", from: "网易云热评" },
  { text: "晚风温柔,黑夜也温柔,你也温柔。", from: "网易云热评" },
  { text: "走过路过的都是风景,留下的才是人生。", from: "网易云热评" },
  { text: "时光不回头,当下最重要。", from: "村上春树" },
  { text: "你别皱眉,我最怕风雪今夜来得早。", from: "网易云热评" },
  { text: "我喜欢出发,凡是到达了的地方,都属于昨天。", from: "汪国真" },
  { text: "心安即是归处。", from: "白居易" },
  { text: "纵有疾风起,人生不言弃。", from: "Le vent se lève" },
  { text: "向来缘浅,奈何情深。", from: "辛夷坞" },
  { text: "繁华一瞬如梦过,清风一缕入心来。", from: "佚名" },
  { text: "希望明天醒来,有人替我去爱你。", from: "网易云热评" },
  { text: "热爱可抵岁月漫长。", from: "梅尔·吉布森" },
  { text: "每个人都有自己的时区,你没有迟到,也没有早退。", from: "网易云热评" },
  { text: "我曾踏月而来,只因你在山中。", from: "席慕容" },
  { text: "愿你出走半生,归来仍是少年。", from: "苏轼(网传)" },
  { text: "万家灯火,总有一盏为你而留。", from: "网易云热评" },
  { text: "海上月是天上月,眼前人是心上人。", from: "张爱玲" },
  { text: "山川是不卷收的画轴,日月为我掌灯伴读。", from: "余光中" },
  { text: "向前走,看远方,别回头。", from: "网易云热评" },
  { text: "理想三旬,天黑路远;愿你眼中有光,愿我心中有梦。", from: "网易云热评" },
  { text: "若无相欠,怎会相见。", from: "白落梅" },
  { text: "故事的小黄花,从出生那年就飘着。", from: "周杰伦《晴天》" },
  { text: "我曾经跨过山和大海,也穿过人山人海。", from: "朴树《平凡之路》" },
  { text: "时间是治愈一切的良药,但前提是不再触碰旧的伤口。", from: "网易云热评" },
  { text: "总有一天你的负担会变成礼物,你受的苦会照亮你的路。", from: "网易云热评" },
];

const CURRENT_KEY = "gptcodex.quote.idx";

// 取上一次显示的句子序号(防止用户刚启动就看到同一句)。
function loadInitialIdx(): number {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n < QUOTES.length) {
        // 每次启动用 (上次 + 1) 那一句,顺序逐句往下
        return (n + 1) % QUOTES.length;
      }
    }
  } catch { /* ignore */ }
  return Math.floor(Math.random() * QUOTES.length);
}

function rollIdx(prev: number): number {
  // 至少跳一句,避免点了「下一句」结果还是同一句
  if (QUOTES.length <= 1) return 0;
  let next = Math.floor(Math.random() * QUOTES.length);
  if (next === prev) next = (next + 1) % QUOTES.length;
  return next;
}

export function HitokotoStrip() {
  const [idx, setIdx] = useState<number>(() => loadInitialIdx());

  useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, String(idx)); } catch { /* ignore */ }
  }, [idx]);

  const q = QUOTES[idx];

  return (
    <div
      className="hidden min-w-0 items-center gap-1.5 md:flex md:flex-1 group cursor-pointer"
      title="点击换一句"
      onClick={() => setIdx((i) => rollIdx(i))}
    >
      <span className="shrink-0 select-none text-zinc-400 dark:text-zinc-600" aria-hidden>“</span>
      <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{q.text}</span>
      {q.from && (
        <span className="shrink-0 select-none text-[10px] text-zinc-400 dark:text-zinc-500">
          — {q.from}
        </span>
      )}
      <RefreshCw className="h-3 w-3 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-zinc-600" />
    </div>
  );
}
