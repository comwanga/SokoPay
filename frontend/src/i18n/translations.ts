// ── Translation strings ───────────────────────────────────────────────────────
//
// Keys use dot notation: "section.sub_key".
// All keys must be defined in English (the fallback language).
// Swahili covers the core marketplace UI; French is a skeleton.

export type SupportedLanguage = 'English' | 'Swahili' | 'French'

export const en: Record<string, string> = {
  // Navigation
  'nav.section.marketplace': 'Marketplace',
  'nav.browse':              'Browse',
  'nav.orders':              'My Orders',
  'nav.price_index':         'Price Index',
  'nav.section.selling':     'Selling',
  'nav.sell':                'My Listings',
  'nav.payments':            'Payment History',
  'nav.settings':            'Display Options',
  'nav.new_listing':         'New Listing',
  'nav.section.admin':       'Admin',
  'nav.admin':               'Disputes & Users',
  'nav.section.account':     'Account',
  'nav.profile':             'Profile',
  'nav.connect':             'Connect',
  'nav.connecting':          'Connecting…',
  'nav.sign_out':            'Sign out',
  'nav.add_lightning':       'Add your Lightning Address to receive payments',
  'nav.converter':           'Converter',

  // Marketplace page
  'market.title':            'Marketplace',
  'market.subtitle':         'Buy & sell anything, pay with Lightning',
  'market.search':           'Search products, sellers…',
  'market.all_countries':    'All countries',
  'market.all_categories':   'All',
  'market.load_more':        'Load more',
  'market.loading':          'Loading…',
  'market.empty':            'No products found.',
  'market.empty_hint':       'Try a different search or category.',
  'market.only_x_left':      'Only {qty} {unit} left',
  'market.ships_globally':   'Ships globally',
  'market.local':            'Local',
  'market.global':           'Global',

  // Marketplace filters / sort
  'market.filters':          'Filters',
  'market.sort_by':          'Sort by',
  'market.in_stock_only':    'In stock only',
  'market.min_price':        'Min price (KES)',
  'market.max_price':        'Max price (KES)',
  'market.clear_filters':    'Clear filters',
  'market.sort.newest':      'Newest',
  'market.sort.price_asc':   'Price: Low → High',
  'market.sort.price_desc':  'Price: High → Low',
  'market.sort.rating':      'Top rated',
  'market.seller_verified':  'Verified seller',

  // Connect prompt
  'connect.title':           'Connect to continue',
  'connect.subtitle':        'This feature requires a Nostr identity. Open SokoPay inside Fedi for instant access, or paste your public key below.',
  'connect.button':          'Connect with Nostr',
  'connect.connecting':      'Connecting…',

  // Display options
  'settings.title':          'Display options',
  'settings.btc_unit':       'Bitcoin unit',
  'settings.fiat_currency':  'Fiat currency',
  'settings.theme':          'Application theme',
  'settings.language':       'Application language',
  'settings.search_currency':'Search currency or country…',
  'settings.no_currencies':  'No currencies match',
  'settings.theme_system':   'Follow system',
  'settings.theme_dark':     'Dark',
  'settings.theme_light':    'Light',

  // Common actions
  'action.back':             'Back',
  'action.cancel':           'Cancel',
  'action.save':             'Save',
  'action.send':             'Send',
  'action.confirm':          'Confirm',
  'action.submit':           'Submit',

  // Order statuses
  'status.pending_payment':  'Pending payment',
  'status.paid':             'Paid',
  'status.processing':       'Processing',
  'status.in_transit':       'In transit',
  'status.delivered':        'Delivered',
  'status.confirmed':        'Confirmed',
  'status.disputed':         'Disputed',
  'status.cancelled':        'Cancelled',
  'status.failed':           'Failed',
}

export const sw: Record<string, string> = {
  // Navigation
  'nav.section.marketplace': 'Soko',
  'nav.browse':              'Tafuta',
  'nav.orders':              'Maagizo Yangu',
  'nav.price_index':         'Faharasa ya Bei',
  'nav.section.selling':     'Kuuza',
  'nav.sell':                'Orodha Zangu',
  'nav.payments':            'Historia ya Malipo',
  'nav.settings':            'Mipangilio',
  'nav.new_listing':         'Orodha Mpya',
  'nav.section.admin':       'Msimamizi',
  'nav.admin':               'Migogoro na Watumiaji',
  'nav.section.account':     'Akaunti',
  'nav.profile':             'Wasifu',
  'nav.connect':             'Unganisha',
  'nav.connecting':          'Inaunganisha…',
  'nav.sign_out':            'Toka',
  'nav.add_lightning':       'Ongeza anwani yako ya Lightning kupokea malipo',
  'nav.converter':           'Kibadilishaji',

  // Marketplace page
  'market.title':            'Soko',
  'market.subtitle':         'Nunua na uze chochote, lipa kwa Lightning',
  'market.search':           'Tafuta bidhaa, wauzaji…',
  'market.all_countries':    'Nchi zote',
  'market.all_categories':   'Zote',
  'market.load_more':        'Pakia zaidi',
  'market.loading':          'Inapakia…',
  'market.empty':            'Hakuna bidhaa zilizopatikana.',
  'market.empty_hint':       'Jaribu utafutaji au kategoria tofauti.',
  'market.only_x_left':      '{qty} {unit} zimebaki tu',
  'market.ships_globally':   'Hutumwa duniani kote',
  'market.local':            'Karibu',
  'market.global':           'Kimataifa',

  // Marketplace filters / sort
  'market.filters':          'Vichujio',
  'market.sort_by':          'Panga kulingana na',
  'market.in_stock_only':    'Zilizopo tu',
  'market.min_price':        'Bei ya chini (KES)',
  'market.max_price':        'Bei ya juu (KES)',
  'market.clear_filters':    'Futa vichujio',
  'market.sort.newest':      'Mpya zaidi',
  'market.sort.price_asc':   'Bei: Chini → Juu',
  'market.sort.price_desc':  'Bei: Juu → Chini',
  'market.sort.rating':      'Iliyopimwa vyema',
  'market.seller_verified':  'Muuzaji aliyethibitishwa',

  // Connect prompt
  'connect.title':           'Unganisha kuendelea',
  'connect.subtitle':        'Kipengele hiki kinahitaji kitambulisho cha Nostr. Fungua SokoPay ndani ya Fedi kupata upatikanaji wa papo hapo, au bandika ufunguo wako wa umma hapa chini.',
  'connect.button':          'Unganisha na Nostr',
  'connect.connecting':      'Inaunganisha…',

  // Display options
  'settings.title':          'Mipangilio ya onyesho',
  'settings.btc_unit':       'Kitengo cha Bitcoin',
  'settings.fiat_currency':  'Sarafu ya kawaida',
  'settings.theme':          'Mandhari ya programu',
  'settings.language':       'Lugha ya programu',
  'settings.search_currency':'Tafuta sarafu au nchi…',
  'settings.no_currencies':  'Hakuna sarafu zinazolingana',
  'settings.theme_system':   'Fuata mfumo',
  'settings.theme_dark':     'Giza',
  'settings.theme_light':    'Mwanga',

  // Common actions
  'action.back':             'Rudi',
  'action.cancel':           'Ghairi',
  'action.save':             'Hifadhi',
  'action.send':             'Tuma',
  'action.confirm':          'Thibitisha',
  'action.submit':           'Wasilisha',

  // Order statuses
  'status.pending_payment':  'Inasubiri malipo',
  'status.paid':             'Amelipwa',
  'status.processing':       'Inashughulikiwa',
  'status.in_transit':       'Njiani',
  'status.delivered':        'Imetolewa',
  'status.confirmed':        'Imethibitishwa',
  'status.disputed':         'Mgogoro',
  'status.cancelled':        'Imefutwa',
  'status.failed':           'Imeshindwa',
}

// French is a stub — falls back to English for untranslated keys.
export const fr: Record<string, string> = {
  'nav.browse':              'Parcourir',
  'nav.orders':              'Mes Commandes',
  'nav.sell':                'Mes Annonces',
  'nav.sign_out':            'Déconnexion',
  'market.title':            'Marché',
  'market.subtitle':         'Achetez et vendez, payez en Lightning',
  'market.search':           'Rechercher produits, vendeurs…',
  'market.load_more':        'Charger plus',
  'market.empty':            'Aucun produit trouvé.',
}

export const TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  English: en,
  Swahili: sw,
  French:  fr,
}
