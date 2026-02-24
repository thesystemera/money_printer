const logoCache = new Map();

/**
 * ATTEMPT 1: The smartest approach.
 * Fetches a company's logo directly from the Wikipedia API.
 * @param {string} companyName - The name of the company (e.g., "Microsoft").
 * @returns {Promise<string|null>} The URL of the logo from the Wikipedia page.
 */
const fetchFromWikipedia = async (companyName) => {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'pageimages',
      pithumbsize: '200', // Request a thumbnail of 200px width
      titles: companyName,
      origin: '*', // Necessary for CORS
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
    const data = await response.json();

    // The API returns pages keyed by an ID, so we get the first page in the result.
    const page = Object.values(data.query.pages)[0];

    if (page && page.thumbnail) {
      console.log(`[LogoService] SUCCESS: Found logo for "${companyName}" via Wikipedia.`);
      return page.thumbnail.source;
    }
    return null;
  } catch (error) {
    console.warn(`[LogoService] Wikipedia lookup failed for "${companyName}".`, error);
    return null;
  }
};


/**
 * ATTEMPT 2: Fallback using domain guessing.
 * @param {string} domain - The domain to try (e.g., "intel.com").
 * @returns {Promise<string|null>} The logo URL if found, otherwise null.
 */
const fetchFromClearbit = async (domain) => {
  if (!domain) return null;
  try {
    const response = await fetch(`https://logo.clearbit.com/${domain}`);
    if (response.ok) {
      console.log(`[LogoService] FALLBACK: Found logo for domain "${domain}" via Clearbit.`);
      return response.url;
    }
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * ATTEMPT 3: The final fallback to ensure a visual is always present.
 * @param {string} name - The company name or symbol.
 * @returns {string} A URL to a generated avatar image.
 */
const generateFallbackAvatar = (name) => {
  console.log(`[LogoService] FINAL FALLBACK: Generating avatar for "${name}"`);
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2d3748&color=edf2f7&bold=true`;
};


/**
 * Fetches a company logo using an intelligent, multi-step fallback strategy.
 * @param {string} companyName - The name of the company.
 * @param {string} symbol - The stock symbol of the company.
 * @returns {Promise<string|null>} A promise that resolves to the logo URL or a fallback avatar.
 */
export const fetchLogoUrl = async (companyName, symbol) => {
  const queryKey = companyName || symbol;
  if (!queryKey) return null;

  // 1. Check cache first.
  if (logoCache.has(queryKey)) {
    return logoCache.get(queryKey);
  }

  let logoUrl = null;

  // 2. PRIMARY STRATEGY: Use Wikipedia for an intelligent search.
  if (companyName) {
    logoUrl = await fetchFromWikipedia(companyName);
  }

  // 3. SECONDARY STRATEGY: If Wikipedia fails, fall back to Clearbit domain matching.
  if (!logoUrl) {
    const domainFromName = companyName
      .toLowerCase()
      .replace(/(\s+(corporation|corp|inc|llc|ltd)\.?$)/, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '')
      .trim();

    logoUrl = await fetchFromClearbit(`${domainFromName}.com`);

    // Try symbol as well if the name-based domain fails.
    if (!logoUrl && symbol) {
      logoUrl = await fetchFromClearbit(`${symbol.toLowerCase()}.com`);
    }
  }

  // 4. FINAL FALLBACK: If all else fails, generate an avatar.
  if (!logoUrl) {
    logoUrl = generateFallbackAvatar(symbol || companyName);
  }

  // 5. Cache the result and return it.
  logoCache.set(queryKey, logoUrl);
  return logoUrl;
};