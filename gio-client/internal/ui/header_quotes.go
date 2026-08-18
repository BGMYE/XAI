package ui

import "time"

type headerQuote struct {
	Text string
	From string
}

var headerQuotes = []headerQuote{
	{Text: "山有顶峰，湖有彼岸；在人生漫漫长途中，万物皆有回转。", From: "网易云热评"},
	{Text: "晚风温柔，黑夜也温柔，你也温柔。", From: "网易云热评"},
	{Text: "走过路过的都是风景，留下的才是人生。", From: "网易云热评"},
	{Text: "时光不回头，当下最重要。", From: "村上春树"},
	{Text: "你别皱眉，我最怕风雪今夜来得早。", From: "网易云热评"},
	{Text: "我喜欢出发，凡是到达了的地方，都属于昨天。", From: "汪国真"},
	{Text: "心安即是归处。", From: "白居易"},
	{Text: "纵有疾风起，人生不言弃。", From: "Le vent se leve"},
	{Text: "向来缘浅，奈何情深。", From: "辛夷坞"},
	{Text: "繁华一瞬如梦过，清风一缕入心来。", From: "佚名"},
	{Text: "希望明天醒来，有人替我去爱你。", From: "网易云热评"},
	{Text: "热爱可抵岁月漫长。", From: "梅尔 吉布森"},
	{Text: "每个人都有自己的时区，你没有迟到，也没有早退。", From: "网易云热评"},
	{Text: "我曾踏月而来，只因你在山中。", From: "席慕容"},
	{Text: "愿你出走半生，归来仍是少年。", From: "苏轼 网传"},
	{Text: "万家灯火，总有一盏为你而留。", From: "网易云热评"},
	{Text: "海上月是天上月，眼前人是心上人。", From: "张爱玲"},
	{Text: "山川是不卷收的画轴，日月为我掌灯伴读。", From: "余光中"},
	{Text: "向前走，看远方，别回头。", From: "网易云热评"},
	{Text: "理想三旬，天黑路远；愿你眼中有光，愿我心中有梦。", From: "网易云热评"},
	{Text: "若无相欠，怎会相见。", From: "白落梅"},
	{Text: "故事的小黄花，从出生那年就飘着。", From: "周杰伦 晴天"},
	{Text: "我曾经跨过山和大海，也穿过人山人海。", From: "朴树 平凡之路"},
	{Text: "时间是治愈一切的良药，但前提是不再触碰旧的伤口。", From: "网易云热评"},
	{Text: "总有一天你的负担会变成礼物，你受的苦会照亮你的路。", From: "网易云热评"},
}

func initialHeaderQuoteIndex(now time.Time) int {
	if len(headerQuotes) == 0 {
		return 0
	}
	idx := int(now.UnixNano() % int64(len(headerQuotes)))
	if idx < 0 {
		idx = -idx
	}
	return idx
}

func nextHeaderQuoteIndex(current int) int {
	if len(headerQuotes) <= 1 {
		return 0
	}
	next := current + 1
	if next >= len(headerQuotes) || next < 0 {
		next = 0
	}
	return next
}

func currentHeaderQuote(index int) headerQuote {
	if len(headerQuotes) == 0 {
		return headerQuote{}
	}
	if index < 0 {
		index = 0
	}
	return headerQuotes[index%len(headerQuotes)]
}
