// frontend/src/services/flags.js — emoji flags for all World Cup 2026 teams.

const FLAGS = {
  // CONMEBOL
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

  // UEFA
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
  "Bosnia-Herzegovina":     "🇧🇦",
  "Albania":                "🇦🇱",
  "Slovenia":               "🇸🇮",
  "Greece":                 "🇬🇷",
  "Georgia":                "🇬🇪",

  // CONCACAF
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
  "Trinidad & Tobago":      "🇹🇹",
  "Curacao":                "🇨🇼",
  "Curaçao":                "🇨🇼",
  "El Salvador":            "🇸🇻",
  "Guatemala":              "🇬🇹",
  "Haiti":                  "🇭🇹",

  // CAF
  "Morocco":                "🇲🇦",
  "Senegal":                "🇸🇳",
  "Egypt":                  "🇪🇬",
  "Nigeria":                "🇳🇬",
  "Ghana":                  "🇬🇭",
  "Cameroon":               "🇨🇲",
  "Ivory Coast":            "🇨🇮",
  "Cote d'Ivoire":          "🇨🇮",
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

  // AFC
  "Japan":                  "🇯🇵",
  "South Korea":            "🇰🇷",
  "Korea Republic":         "🇰🇷",
  "Saudi Arabia":           "🇸🇦",
  "Iran":                   "🇮🇷",
  "IR Iran":                "🇮🇷",
  "Australia":              "🇦🇺",
  "Qatar":                  "🇶🇦",
  "Iraq":                   "🇮🇶",
  "Jordan":                 "🇯🇴",
  "Uzbekistan":             "🇺🇿",
  "China":                  "🇨🇳",
  "Indonesia":              "🇮🇩",
  "Vietnam":                "🇻🇳",
  "Thailand":               "🇹🇭",
  "Myanmar":                "🇲🇲",
  "Philippines":            "🇵🇭",
  "UAE":                    "🇦🇪",
  "United Arab Emirates":   "🇦🇪",

  // OFC
  "New Zealand":            "🇳🇿",
  "Fiji":                   "🇫🇯",
};

function getFlag(teamName) {
  if (!teamName) return "⚽";
  if (FLAGS[teamName]) return FLAGS[teamName];
  const lower = teamName.toLowerCase().trim();
  const exactKey = Object.keys(FLAGS).find(k => k.toLowerCase() === lower);
  if (exactKey) return FLAGS[exactKey];
  const partialKey = Object.keys(FLAGS).find(k =>
    lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)
  );
  if (partialKey) return FLAGS[partialKey];
  const firstWord = lower.split(" ")[0];
  if (firstWord.length > 3) {
    const firstKey = Object.keys(FLAGS).find(k => k.toLowerCase().startsWith(firstWord));
    if (firstKey) return FLAGS[firstKey];
  }
  return "⚽";
}
