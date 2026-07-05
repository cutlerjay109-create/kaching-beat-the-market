// frontend/src/services/flags.js — image flags (flagcdn.com), render on every OS.
// Emoji flags don't render on Windows/many Linux setups, so we use <img> instead.

const FLAG_CODES = {
  // CONMEBOL
  "Argentina":"ar","Brazil":"br","Colombia":"co","Uruguay":"uy","Ecuador":"ec",
  "Paraguay":"py","Venezuela":"ve","Chile":"cl","Bolivia":"bo","Peru":"pe",
  // UEFA
  "France":"fr","England":"gb-eng","Spain":"es","Portugal":"pt","Germany":"de",
  "Netherlands":"nl","Belgium":"be","Switzerland":"ch","Croatia":"hr","Austria":"at",
  "Norway":"no","Scotland":"gb-sct","Wales":"gb-wls","Denmark":"dk","Poland":"pl",
  "Serbia":"rs","Sweden":"se","Hungary":"hu","Romania":"ro","Ukraine":"ua",
  "Turkey":"tr","Turkiye":"tr","Czech Republic":"cz","Slovakia":"sk",
  "Bosnia and Herzegovina":"ba","Albania":"al","Slovenia":"si","Greece":"gr","Georgia":"ge",
  // CONCACAF
  "USA":"us","United States":"us","Canada":"ca","Mexico":"mx","Costa Rica":"cr",
  "Honduras":"hn","Panama":"pa","Jamaica":"jm","Cuba":"cu","Trinidad and Tobago":"tt",
  "Curacao":"cw","Cura\u00e7ao":"cw","El Salvador":"sv","Guatemala":"gt","Haiti":"ht",
  // CAF
  "Morocco":"ma","Senegal":"sn","Egypt":"eg","Nigeria":"ng","Ghana":"gh","Cameroon":"cm",
  "Ivory Coast":"ci","Algeria":"dz","Tunisia":"tn","Mali":"ml","South Africa":"za",
  "Congo DR":"cd","DR Congo":"cd","Democratic Republic of Congo":"cd",
  "Cape Verde":"cv","Cabo Verde":"cv","Zambia":"zm","Tanzania":"tz","Uganda":"ug",
  // AFC
  "Japan":"jp","South Korea":"kr","Korea Republic":"kr","Saudi Arabia":"sa","Iran":"ir",
  "Australia":"au","Qatar":"qa","Iraq":"iq","Jordan":"jo","Uzbekistan":"uz","China":"cn",
  "India":"in","Vietnam":"vn","Thailand":"th","Myanmar":"mm","Indonesia":"id",
  "Philippines":"ph","Bahrain":"bh","UAE":"ae","United Arab Emirates":"ae","Oman":"om",
  "Kuwait":"kw","Palestine":"ps","Lebanon":"lb",
  // OFC
  "New Zealand":"nz","Fiji":"fj","Papua New Guinea":"pg","Solomon Islands":"sb","Vanuatu":"vu",
};

function _codeFor(teamName) {
  if (!teamName) return null;
  if (FLAG_CODES[teamName]) return FLAG_CODES[teamName];
  const lower = teamName.trim().toLowerCase();
  const exact = Object.keys(FLAG_CODES).find(k => k.toLowerCase() === lower);
  if (exact) return FLAG_CODES[exact];
  // conservative partial: a known name fully contained in the feed's name
  const part = Object.keys(FLAG_CODES).find(k => lower.includes(k.toLowerCase()));
  return part ? FLAG_CODES[part] : null;
}

// Returns an <img> tag string (or a ball emoji if the team is unknown).
function getFlag(teamName) {
  const code = _codeFor(teamName);
  if (!code) return "\u26bd";
  const url = "https://flagcdn.com/" + code + ".svg";
  return '<img src="' + url + '" alt="' + (teamName || "") +
         '" loading="lazy" ' +
         'style="width:32px;height:22px;border-radius:3px;object-fit:cover;' +
         'vertical-align:middle;box-shadow:0 0 0 1px rgba(0,0,0,0.15);">';
}
