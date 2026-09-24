import { extendTheme, type ThemeConfig } from '@chakra-ui/react'

// Kartoza brand palette — one palette only. The system is flat: no
// shadows or gradients. Amber and blue are accents, never body text;
// charcoal (#383939) carries body copy. The map motif reuses these same
// colours (Light Grey parcels, Cloud roads, White streets, Kartoza Blue
// water, Kartoza Amber zones).
export const brand = {
  blue: '#54A2CC',
  amber: '#EEB348',
  grey: '#8A8B8B',
  charcoal: '#383939',
  muted: '#676869',
  rule: '#D1D1D1',
  cloud: '#F5F5F2',
  white: '#FFFFFF',
  success: '#3C7D54',
  successTint: '#EAF3EC',
  warn: '#EEB348',
  warnTint: '#FCF3E0',
  error: '#B0473C',
  errorTint: '#FBEFEF',
}

// Tint/shade scales built around each brand colour so Chakra's
// colorScheme-driven components (Button, Badge, Tag, Alert...) stay on-palette.
const blueScale = {
  50: '#EEF6FA',
  100: '#D4E8F3',
  200: '#B3D6EA',
  300: '#8CC1DF',
  400: '#6FB1D6',
  500: brand.blue,
  600: '#3F8AB3',
  700: '#316E90',
  800: '#25536C',
  900: '#193848',
}

const amberScale = {
  50: brand.warnTint,
  100: '#FAE6BF',
  200: '#F6D593',
  300: '#F2C46B',
  400: brand.amber,
  500: '#E0A02F',
  600: '#C4861F',
  700: '#9E6B18',
  800: '#785113',
  900: '#52370D',
}

const neutralScale = {
  50: brand.cloud,
  100: '#EDEDEA',
  200: '#E2E2E0',
  300: brand.rule,
  400: '#B0B1B1',
  500: brand.grey,
  600: brand.muted,
  700: '#4F5051',
  800: '#414242',
  900: brand.charcoal,
}

const successScale = {
  50: brand.successTint,
  100: '#CFE4D5',
  200: '#A9CEB4',
  300: '#7FB48E',
  400: '#5A9A6D',
  500: brand.success,
  600: '#336B48',
  700: '#2A583B',
  800: '#20442E',
  900: '#163020',
}

const errorScale = {
  50: brand.errorTint,
  100: '#F3D6D3',
  200: '#E7B1AB',
  300: '#D78A81',
  400: '#C4675C',
  500: brand.error,
  600: '#963C33',
  700: '#7B312A',
  800: '#602620',
  900: '#451B17',
}

const colors = {
  kartoza: blueScale,
  accent: amberScale,
  gray: neutralScale,
  // Chakra's stock palettes are folded onto the brand ones, so any
  // colorScheme="blue"/"green"/"purple"... elsewhere stays on-palette.
  blue: blueScale,
  cyan: blueScale,
  teal: blueScale,
  orange: amberScale,
  yellow: amberScale,
  green: successScale,
  red: errorScale,
  purple: neutralScale,
  pink: neutralScale,
}

// Flat: elevation is shown with a hairline rule, never a drop shadow.
const hairline = `0 0 0 1px ${brand.rule}`
const shadows = {
  xs: hairline,
  sm: hairline,
  base: hairline,
  md: hairline,
  lg: hairline,
  xl: hairline,
  '2xl': hairline,
  'dark-lg': hairline,
  inner: 'none',
  kartoza: hairline,
  kartozaHover: hairline,
  navbar: `0 1px 0 0 ${brand.rule}`,
  accent: 'none',
  accentHover: 'none',
}

// Tight corners throughout.
const radii = {
  none: '0',
  sm: '2px',
  base: '3px',
  md: '3px',
  lg: '4px',
  xl: '6px',
  '2xl': '8px',
  '3xl': '10px',
  full: '9999px',
}

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
}

const theme = extendTheme({
  config,
  colors,
  shadows,
  radii,
  fonts: {
    heading: "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif",
    body: "'Nunito', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace",
  },
  styles: {
    global: {
      body: {
        bg: 'surface.cloud',
        color: 'text.default',
      },
      // Legacy class names kept (still referenced in places) but flattened.
      '.kartoza-gradient, .kartoza-gradient-dark, .kartoza-gradient-horizontal': {
        background: brand.charcoal,
      },
      '.kartoza-gradient-accent': {
        background: brand.warnTint,
      },
      '.kartoza-card': {
        borderRadius: '4px',
        border: `1px solid ${brand.rule}`,
      },
      '.kartoza-text-gradient': {
        color: brand.white,
      },
      '.kartoza-accent-italic': {
        fontStyle: 'italic',
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: 'md',
        fontWeight: '600',
        transition: 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
      },
      defaultProps: {
        colorScheme: 'kartoza',
      },
      variants: {
        solid: {
          bg: 'kartoza.500',
          color: 'white',
          _hover: {
            bg: 'kartoza.600',
          },
        },
        outline: {
          borderColor: 'kartoza.500',
          borderWidth: '1px',
          color: 'kartoza.700',
          _hover: {
            bg: 'kartoza.50',
          },
        },
        ghost: {
          color: 'kartoza.700',
          _hover: {
            bg: 'kartoza.50',
          },
        },
        // Amber is an accent surface — its label stays charcoal for contrast.
        accent: {
          bg: 'accent.400',
          color: 'text.default',
          _hover: {
            bg: 'accent.500',
          },
          _active: {
            bg: 'accent.600',
          },
          _disabled: {
            bg: 'accent.200',
            color: 'text.muted',
            cursor: 'not-allowed',
            opacity: 1,

            _hover: {
              bg: 'accent.200 !important',
            },
            _active: {
              bg: 'accent.200 !important',
            },
          },
        },
        'accent-outline': {
          borderColor: 'accent.400',
          borderWidth: '1px',
          color: 'text.default',
          _hover: {
            bg: 'accent.50',
          },
        },
        heroPrimary: {
          bg: 'accent.400',
          color: 'text.default',
          px: 10,
          py: 6,
          fontSize: 'md',
          fontWeight: '700',
          _hover: {
            bg: 'accent.500',
          },
        },
        heroSecondary: {
          bg: 'transparent',
          color: 'white',
          borderWidth: '1px',
          borderColor: 'white',
          px: 10,
          py: 6,
          fontSize: 'md',
          fontWeight: '600',
          _hover: {
            bg: 'whiteAlpha.200',
          },
        },
      },
      sizes: {
        lg: {
          fontSize: 'md',
          px: 8,
          py: 6,
        },
        xl: {
          fontSize: 'lg',
          px: 10,
          py: 7,
          minW: '200px',
        },
      },
    },
    Link: {
      baseStyle: {
        color: 'kartoza.700',
        _hover: {
          textDecoration: 'underline',
          color: 'kartoza.800',
        },
      },
    },
    Heading: {
      baseStyle: {
        color: 'text.default',
        fontWeight: '700',
      },
      variants: {
        brand: {
          color: 'text.default',
        },
        accent: {
          color: 'text.default',
          fontStyle: 'italic',
          fontWeight: '600',
        },
        hero: {
          color: 'white',
          fontWeight: '800',
        },
      },
    },
    Code: {
      baseStyle: {
        fontFamily: 'mono',
        borderRadius: 'sm',
      },
    },
    Kbd: {
      baseStyle: {
        fontFamily: 'mono',
        borderRadius: 'sm',
      },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: 'lg',
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'rule.line',
          overflow: 'hidden',
        },
        header: {
          color: 'text.default',
        },
      },
      variants: {
        elevated: {
          container: {
            boxShadow: 'none',
          },
        },
        feature: {
          container: {
            borderLeft: '3px solid',
            borderLeftColor: 'kartoza.500',
          },
        },
        accent: {
          container: {
            borderTop: '3px solid',
            borderTopColor: 'accent.400',
          },
        },
      },
    },
    Modal: {
      baseStyle: {
        dialog: {
          borderRadius: 'lg',
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'rule.line',
        },
        header: {
          borderBottom: '1px solid',
          borderBottomColor: 'rule.line',
          color: 'text.default',
        },
        footer: {
          borderTop: '1px solid',
          borderTopColor: 'rule.line',
        },
      },
    },
    Drawer: {
      baseStyle: {
        dialog: {
          boxShadow: 'none',
        },
      },
    },
    Popover: {
      baseStyle: {
        content: {
          borderRadius: 'lg',
          boxShadow: 'none',
          borderColor: 'rule.line',
        },
      },
    },
    Input: {
      defaultProps: {
        focusBorderColor: 'kartoza.500',
      },
      baseStyle: {
        field: {
          borderRadius: 'md',
        },
      },
    },
    Select: {
      defaultProps: {
        focusBorderColor: 'kartoza.500',
      },
    },
    Textarea: {
      defaultProps: {
        focusBorderColor: 'kartoza.500',
      },
    },
    Checkbox: {
      defaultProps: {
        colorScheme: 'kartoza',
      },
    },
    Switch: {
      defaultProps: {
        colorScheme: 'kartoza',
      },
    },
    Progress: {
      defaultProps: {
        colorScheme: 'kartoza',
      },
    },
    Tabs: {
      defaultProps: {
        colorScheme: 'kartoza',
      },
    },
    Badge: {
      baseStyle: {
        borderRadius: 'sm',
        fontWeight: '600',
      },
      variants: {
        subtle: {
          bg: 'kartoza.50',
          color: 'kartoza.800',
        },
        solid: {
          bg: 'kartoza.500',
          color: 'white',
        },
        accent: {
          bg: 'accent.400',
          color: 'text.default',
        },
        accentSubtle: {
          bg: 'accent.50',
          color: 'accent.800',
        },
      },
    },
    Tag: {
      baseStyle: {
        container: {
          borderRadius: 'sm',
        },
      },
    },
    Stat: {
      baseStyle: {
        container: {
          p: 4,
        },
        label: {
          color: 'text.muted',
          fontSize: 'sm',
          fontWeight: '500',
        },
        number: {
          color: 'text.default',
          fontWeight: '700',
        },
        helpText: {
          color: 'text.muted',
        },
      },
    },
    Divider: {
      baseStyle: {
        borderColor: 'rule.line',
      },
    },
    Menu: {
      baseStyle: {
        list: {
          borderRadius: 'lg',
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'rule.line',
        },
        item: {
          _hover: {
            bg: 'kartoza.50',
          },
          _focus: {
            bg: 'kartoza.50',
          },
        },
      },
    },
    Tooltip: {
      baseStyle: {
        borderRadius: 'md',
        bg: 'text.default',
        color: 'white',
        boxShadow: 'none',
        px: 3,
        py: 2,
      },
    },
    Alert: {
      variants: {
        subtle: {
          container: {
            borderRadius: 'lg',
          },
        },
        solid: {
          container: {
            borderRadius: 'lg',
          },
        },
      },
    },
  },
  semanticTokens: {
    colors: {
      'kartoza.blue': brand.blue,
      'kartoza.amber': brand.amber,
      'kartoza.grey': brand.grey,
      'text.default': brand.charcoal,
      'text.muted': brand.muted,
      'rule.line': brand.rule,
      'surface.cloud': brand.cloud,
      'surface.white': brand.white,
      // Flat charcoal band used for dialog/panel headers (white text on top).
      'surface.header': brand.charcoal,
      'status.success': brand.success,
      'status.success.tint': brand.successTint,
      'status.warn': brand.warn,
      'status.warn.tint': brand.warnTint,
      'status.error': brand.error,
      'status.error.tint': brand.errorTint,
      primary: 'kartoza.500',
      'primary.dark': 'kartoza.700',
      'primary.light': 'kartoza.300',
      secondary: 'accent.400',
      success: brand.success,
      error: brand.error,
      warning: brand.warn,
      info: 'kartoza.500',
      'chakra-body-text': brand.charcoal,
      'chakra-body-bg': brand.cloud,
      'chakra-border-color': brand.rule,
    },
  },
})

export default theme
