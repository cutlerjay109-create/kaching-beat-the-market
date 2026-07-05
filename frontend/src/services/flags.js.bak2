// frontend/src/services/flags.js — all 48 World Cup 2026 teams + common variations.

const FLAGS = {
  // ── CONMEBOL (South America) ──
  "Argentina":              "🇦🇷",
  "Brazil":                 "🇧🇷",
  "Colombia":               "🇨🇴",
  "Uruguay":                "🇺🇾",
  "Ecuador":                "🇪🇨",
  "Paraguay":               "🇵🇾",
  "Venezuela":              "🇻🇪",
  "Chile":                  "🇨🇱",
  "Bolivia":                "🇧🇴",
  "Peru":                   "🇵🇪",

  // ── UEFA (Europe) ──
  "France":                 "🇫🇷",
  "England":                "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Spain":                  "🇪🇸",
  "Portugal":               "🇵🇹",
  "Germany":                "🇩🇪",
  "Netherlands":            "🇳🇱",
  "Belgium":                "🇧🇪",
  "Switzerland":            "🇨🇭",
  "Croatia":                "🇭🇷",
  "Austria":                "🇦🇹",
  "Norway":                 "🇳🇴",
  "Scotland":               "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "Wales":                  "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "Denmark":                "🇩🇰",
  "Poland":                 "🇵🇱",
  "Serbia":                 "🇷🇸",
  "Sweden":                 "🇸🇪",
  "Hungary":                "🇭🇺",
  "Romania":                "🇷🇴",
  "Ukraine":                "🇺🇦",
  "Turkey":                 "🇹🇷",
  "Turkiye":                "🇹🇷",
  "Czech Republic":         "🇨🇿",
  "Slovakia":               "🇸🇰",
  "Bosnia and Herzegovina": "🇧🇦",
  "Albania":                "🇦🇱",
  "Slovenia":               "🇸🇮",
  "Greece":                 "🇬🇷",
  "Georgia":                "🇬🇪",

  // ── CONCACAF (North/Central America & Caribbean) ──
  "USA":                    "🇺🇸",
  "United States":          "🇺🇸",
  "Canada":                 "🇨🇦",
  "Mexico":                 "🇲🇽",
  "Costa Rica":             "🇨🇷",
  "Honduras":               "🇭🇳",
  "Panama":                 "🇵🇦",
  "Jamaica":                "🇯🇲",
  "Cuba":                   "🇨🇺",
  "Trinidad and Tobago":    "🇹🇹",
  "Curacao":                "🇨🇼",
  "Curaçao":                "🇨🇼",
  "El Salvador":            "🇸🇻",
  "Guatemala":              "🇬🇹",
  "Haiti":                  "🇭🇹",

  // ── CAF (Africa) ──
  "Morocco":                "🇲🇦",
  "Senegal":                "🇸🇳",
  "Egypt":                  "🇪🇬",
  "Nigeria":                "🇳🇬",
  "Ghana":                  "🇬🇭",
  "Cameroon":               "🇨🇲",
  "Ivory Coast":            "🇨🇮",
  "Algeria":                "🇩🇿",
  "Tunisia":                "🇹🇳",
  "Mali":                   "🇲🇱",
  "South Africa":           "🇿🇦",
  "Congo DR":               "🇨🇩",
  "DR Congo":               "🇨🇩",
  "Democratic Republic of Congo": "🇨🇩",
  "Cape Verde":             "🇨🇻",
  "Cabo Verde":             "🇨🇻",
  "Zambia":                 "🇿🇲",
  "Tanzania":               "🇹🇿",
  "Uganda":                 "🇺🇬",

  // ── AFC (Asia) ──
  "Japan":                  "🇯🇵",
  "South Korea":            "🇰🇷",
  "Korea Republic":         "🇰🇷",
  "Saudi Arabia":           "🇸🇦",
  "Iran":                   "🇮🇷",
  "Australia":              "🇦🇺",
  "Qatar":                  "🇶🇦",
  "Iraq":                   "🇮🇶",
  "Jordan":                 "🇯🇴",
  "Uzbekistan":             "🇺🇿",
  "China":                  "🇨🇳",
  "India":                  "🇮🇳",
  "Vietnam":                "🇻🇳",
  "Thailand":               "🇹🇭",
  "Myanmar":                "🇲🇲",
  "Indonesia":              "🇮🇩",
  "Philippines":            "🇵🇭",
  "Bahrain":                "🇧🇭",
  "UAE":                    "🇦🇪",
  "United Arab Emirates":   "🇦🇪",
  "Oman":                   "🇴🇲",
  "Kuwait":                 "🇰🇼",
  "Palestine":              "🇵🇸",
  "Lebanon":                "🇱🇧",

  // ── OFC (Oceania) ──
  "New Zealand":            "🇳🇿",
  "Fiji":                   "🇫🇯",
  "Papua New Guinea":       "🇵🇬",
  "Solomon Islands":        "🇸🇧",
  "Vanuatu":                "🇻🇺",
};

function getFlag(teamName) {
  if (!teamName) return "⚽";
  // Direct match
  if (FLAGS[teamName]) return FLAGS[teamName];
  // Case-insensitive exact match
  const lower = teamName.toLowerCase();
  const exactKey = Object.keys(FLAGS).find(k => k.toLowerCase() === lower);
  if (exactKey) return FLAGS[exactKey];
  // Partial match — team name contains key or key contains team name
  const partialKey = Object.keys(FLAGS).find(k =>
    lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)
  );
  return partialKey ? FLAGS[partialKey] : "⚽";
}
