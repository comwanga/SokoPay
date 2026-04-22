/** Maps search query terms to product categories via keyword inference. */

const KEYWORD_MAP: Record<string, string> = {
  // Food & Groceries
  maize: 'Food & Groceries', corn: 'Food & Groceries', ugali: 'Food & Groceries',
  tomato: 'Food & Groceries', tomatoes: 'Food & Groceries', onion: 'Food & Groceries',
  onions: 'Food & Groceries', rice: 'Food & Groceries', beans: 'Food & Groceries',
  milk: 'Food & Groceries', eggs: 'Food & Groceries', sugar: 'Food & Groceries',
  flour: 'Food & Groceries', oil: 'Food & Groceries', meat: 'Food & Groceries',
  chicken: 'Food & Groceries', fish: 'Food & Groceries', vegetable: 'Food & Groceries',
  vegetables: 'Food & Groceries', fruit: 'Food & Groceries', fruits: 'Food & Groceries',
  avocado: 'Food & Groceries', mango: 'Food & Groceries', banana: 'Food & Groceries',
  pineapple: 'Food & Groceries', sukuma: 'Food & Groceries', kale: 'Food & Groceries',
  spinach: 'Food & Groceries', cabbage: 'Food & Groceries', potato: 'Food & Groceries',
  potatoes: 'Food & Groceries', cassava: 'Food & Groceries', yam: 'Food & Groceries',
  wheat: 'Food & Groceries', sorghum: 'Food & Groceries', millet: 'Food & Groceries',

  // Electronics
  phone: 'Electronics', smartphone: 'Electronics', iphone: 'Electronics',
  samsung: 'Electronics', tecno: 'Electronics', infinix: 'Electronics',
  laptop: 'Electronics', computer: 'Electronics', tablet: 'Electronics',
  ipad: 'Electronics', television: 'Electronics', tv: 'Electronics',
  speaker: 'Electronics', headphones: 'Electronics', earphones: 'Electronics',
  charger: 'Electronics', powerbank: 'Electronics', router: 'Electronics',
  camera: 'Electronics', printer: 'Electronics', monitor: 'Electronics',
  keyboard: 'Electronics', mouse: 'Electronics', earbuds: 'Electronics',

  // Fashion & Clothing
  dress: 'Fashion & Clothing', shirt: 'Fashion & Clothing', trouser: 'Fashion & Clothing',
  trousers: 'Fashion & Clothing', jeans: 'Fashion & Clothing', shoes: 'Fashion & Clothing',
  sneakers: 'Fashion & Clothing', boots: 'Fashion & Clothing', heels: 'Fashion & Clothing',
  jacket: 'Fashion & Clothing', coat: 'Fashion & Clothing', suit: 'Fashion & Clothing',
  tie: 'Fashion & Clothing', belt: 'Fashion & Clothing', handbag: 'Fashion & Clothing',
  bag: 'Fashion & Clothing', wallet: 'Fashion & Clothing', cap: 'Fashion & Clothing',
  hat: 'Fashion & Clothing', skirt: 'Fashion & Clothing', blouse: 'Fashion & Clothing',
  fabric: 'Fashion & Clothing', kitenge: 'Fashion & Clothing', ankara: 'Fashion & Clothing',

  // Home & Furniture
  sofa: 'Home & Furniture', bed: 'Home & Furniture', mattress: 'Home & Furniture',
  table: 'Home & Furniture', chair: 'Home & Furniture', wardrobe: 'Home & Furniture',
  curtain: 'Home & Furniture', carpet: 'Home & Furniture', fridge: 'Home & Furniture',
  refrigerator: 'Home & Furniture', oven: 'Home & Furniture', microwave: 'Home & Furniture',
  cooker: 'Home & Furniture', blender: 'Home & Furniture', kettle: 'Home & Furniture',
  pot: 'Home & Furniture', pan: 'Home & Furniture', plates: 'Home & Furniture',
  cutlery: 'Home & Furniture', lamp: 'Home & Furniture', fan: 'Home & Furniture',

  // Health & Beauty
  lotion: 'Health & Beauty', cream: 'Health & Beauty', soap: 'Health & Beauty',
  shampoo: 'Health & Beauty', perfume: 'Health & Beauty', makeup: 'Health & Beauty',
  lipstick: 'Health & Beauty', mascara: 'Health & Beauty', vitamins: 'Health & Beauty',
  supplement: 'Health & Beauty', medicine: 'Health & Beauty', mask: 'Health & Beauty',
  sanitizer: 'Health & Beauty', toothpaste: 'Health & Beauty', hair: 'Health & Beauty',

  // Agriculture
  fertilizer: 'Agriculture', pesticide: 'Agriculture', herbicide: 'Agriculture',
  seed: 'Agriculture', seeds: 'Agriculture', seedlings: 'Agriculture',
  tractor: 'Agriculture', plough: 'Agriculture', hoe: 'Agriculture',
  irrigation: 'Agriculture', greenhouse: 'Agriculture', farm: 'Agriculture',
  livestock: 'Agriculture', cattle: 'Agriculture', goat: 'Agriculture',
  sheep: 'Agriculture', pig: 'Agriculture', poultry: 'Agriculture',

  // Vehicles
  car: 'Vehicles', vehicle: 'Vehicles', truck: 'Vehicles', bus: 'Vehicles',
  motorbike: 'Vehicles', motorcycle: 'Vehicles', bicycle: 'Vehicles',
  tyre: 'Vehicles', tyres: 'Vehicles', spare: 'Vehicles', matatu: 'Vehicles',

  // Property
  land: 'Property', plot: 'Property', house: 'Property', apartment: 'Property',
  rental: 'Property', office: 'Property', warehouse: 'Property',

  // Services
  repair: 'Services', plumbing: 'Services', electrical: 'Services',
  cleaning: 'Services', catering: 'Services', photography: 'Services',
  design: 'Services', tailoring: 'Services', tutoring: 'Services',

  // Arts & Crafts
  painting: 'Arts & Crafts', sculpture: 'Arts & Crafts', basket: 'Arts & Crafts',
  beads: 'Arts & Crafts', jewelry: 'Arts & Crafts', jewellery: 'Arts & Crafts',
  necklace: 'Arts & Crafts', bracelet: 'Arts & Crafts', earrings: 'Arts & Crafts',
  craft: 'Arts & Crafts', handmade: 'Arts & Crafts', art: 'Arts & Crafts',
}

/** Returns the inferred category for a search query, or null if no match. */
export function inferCategory(query: string): string | null {
  const words = query.toLowerCase().trim().split(/\s+/)
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '')
    if (KEYWORD_MAP[clean]) return KEYWORD_MAP[clean]
    // Prefix match for words like "tomatoes" → "tomato"
    for (const [kw, cat] of Object.entries(KEYWORD_MAP)) {
      if (clean.startsWith(kw) || kw.startsWith(clean)) return cat
    }
  }
  return null
}

export function useSmartSearch(query: string) {
  const suggested = query.trim().length >= 3 ? inferCategory(query) : null
  return { suggestedCategory: suggested }
}
