import { extendTheme, type ThemeConfig } from '@chakra-ui/react'

// Kartoza brand colors - matching kartoza.com website
// Deep navy/teal gradient background with gold accents
const colors = {
  // Primary blue/teal - Kartoza brand (matching website hero)
  kartoza: {
    50: '#e8f4f8',   // lightest
    100: '#c5e3ed',
    200: '#9fd0e0',
    300: '#6bb8cf',  // lighter teal
    400: '#4a9cb8',  // medium teal
    500: '#2d7d9b',  // Primary teal
    600: '#1f6a8a',  // darker teal (news ticker)
    700: '#175a77',  // dark teal
    800: '#0f4a64',  // very dark teal
    900: '#0a3a50',  // darkest (hero background base)
  },
  // Gold/orange accent - Kartoza brand gold (CTA buttons)
  accent: {
    50: '#fef8eb',
    100: '#fcecc8',
    200: '#f9dda2',
    300: '#f5c97a',
    400: '#E8A331',  // Primary brand gold (CTA buttons)
    500: '#d99429',  // slightly darker
    600: '#c28424',  // hover state
    700: '#a6701f',
    800: '#8a5c1a',
    900: '#6e4915',
  },
  // Grays
  gray: {
    50: '#f8f9fa',   // Light backgrounds
    100: '#f1f3f5',  // Alternate backgrounds
    200: '#e9ecef',
    300: '#dee2e6',
    400: '#ced4da',
    500: '#adb5bd',
    600: '#6c757d',  // Secondary text
    700: '#495057',  // Dark text
    800: '#343a40',
    900: '#212529',  // Primary text
  },
}

// Kartoza shadows using brand blue #1B6B9B (27, 107, 155) - matching Hugo website
const shadows = {
  sm: '0 2px 8px rgba(27, 107, 155, 0.08)',
  md: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
  lg: '0 8px 28px rgba(27, 107, 155, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
  xl: '0 16px 48px rgba(27, 107, 155, 0.20)',
  kartoza: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
  kartozaHover: '0 8px 28px rgba(27, 107, 155, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
  navbar: '0 2px 12px rgba(27, 107, 155, 0.08)',
  accent: '0 4px 20px rgba(232, 163, 49, 0.4)', // Brand gold #E8A331
  accentHover: '0 6px 28px rgba(232, 163, 49, 0.5)',
}

// Border radii matching Hugo website (organic rounded design)
const radii = {
  sm: '8px',   // Small UI elements
  md: '12px',  // Default - buttons, cards, notifications
  lg: '16px',  // Larger cards, sections
  xl: '20px',  // Hero sections, decorative elements
  '2xl': '32px',
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
    heading: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    body: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  styles: {
    global: {
      body: {
        bg: 'gray.50',
        color: 'gray.900',
      },
      // Custom CSS for Kartoza styling - matching kartoza.com website
      '.kartoza-gradient': {
        background: 'linear-gradient(135deg, #0a3a50 0%, #175a77 50%, #2d7d9b 100%)',
      },
      '.kartoza-gradient-dark': {
        background: 'linear-gradient(135deg, #0a3a50 0%, #0f4a64 100%)',
      },
      '.kartoza-gradient-horizontal': {
        background: 'linear-gradient(90deg, #0a3a50 0%, #2d7d9b 100%)',
      },
      '.kartoza-gradient-accent': {
        background: 'linear-gradient(135deg, rgba(232, 163, 49, 0.15) 0%, rgba(212, 146, 42, 0.1) 100%)',
      },
      '.kartoza-card': {
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
        transition: 'box-shadow 0.3s ease',
        _hover: {
          boxShadow: '0 8px 28px rgba(27, 107, 155, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
        },
      },
      '.kartoza-text-gradient': {
        background: 'linear-gradient(180deg, #ffffff 0%, rgba(255, 255, 255, 0.9) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: '10px',
        fontWeight: '600',
        transition: 'all 0.25s ease',
      },
      defaultProps: {
        colorScheme: 'kartoza',
      },
      variants: {
        solid: {
          bg: 'kartoza.500',
          color: 'white',
          boxShadow: '0 2px 8px rgba(27, 107, 155, 0.12)',
          _hover: {
            bg: 'kartoza.700',
            boxShadow: '0 4px 14px rgba(27, 107, 155, 0.20)',
          },
        },
        outline: {
          borderColor: 'kartoza.500',
          borderWidth: '2px',
          color: 'kartoza.500',
          _hover: {
            bg: 'kartoza.50',
          },
        },
        ghost: {
          color: 'kartoza.500',
          _hover: {
            bg: 'kartoza.50',
          },
        },
        accent: {
          bg: 'accent.400',
          color: 'white',
          boxShadow: '0 4px 20px rgba(232, 163, 49, 0.4)',
          _hover: {
            bg: 'accent.600',
            boxShadow: '0 6px 28px rgba(232, 163, 49, 0.5)',
          },
          _active: {
            bg: 'accent.700',
          },
          _disabled: {
            bg: 'accent.200',
            color: 'white',
            boxShadow: 'none',
            cursor: 'not-allowed',
            opacity: 1,

            _hover: {
              bg: 'accent.200 !important',
              boxShadow: 'none',
            },
            _active: {
              bg: 'accent.200 !important',
            },
          },
        },
        'accent-outline': {
          borderColor: 'accent.400',
          borderWidth: '2px',
          color: 'accent.500',
          _hover: {
            bg: 'accent.50',
          },
        },
        // Hero button styles matching Hugo website
        heroPrimary: {
          bg: 'accent.400',
          color: 'white',
          boxShadow: '0 4px 20px rgba(232, 163, 49, 0.4)',
          px: 10,
          py: 6,
          fontSize: 'md',
          fontWeight: '600',
          _hover: {
            bg: 'accent.600',
            boxShadow: '0 6px 28px rgba(232, 163, 49, 0.5)',
          },
        },
        heroSecondary: {
          bg: 'transparent',
          color: 'white',
          borderWidth: '2px',
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
        color: 'kartoza.500',
        _hover: {
          textDecoration: 'underline',
          color: 'kartoza.700',
        },
      },
    },
    Heading: {
      baseStyle: {
        color: 'gray.900',
        fontWeight: '600',
      },
      variants: {
        brand: {
          color: 'kartoza.700',
        },
        accent: {
          color: 'accent.400',
          fontWeight: '600',
        },
        hero: {
          color: 'white',
          fontWeight: '700',
          textShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        },
      },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
          transition: 'box-shadow 0.3s ease',
          overflow: 'hidden',
          _hover: {
            boxShadow: '0 8px 28px rgba(27, 107, 155, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08)',
          },
        },
        header: {
          color: 'kartoza.700',
        },
      },
      variants: {
        elevated: {
          container: {},
        },
        feature: {
          container: {
            borderLeft: '4px solid',
            borderLeftColor: 'kartoza.500',
          },
        },
        accent: {
          container: {
            borderTop: '4px solid',
            borderTopColor: 'accent.400',
          },
        },
      },
    },
    Modal: {
      baseStyle: {
        dialog: {
          borderRadius: '12px',
          boxShadow: '0 16px 48px rgba(27, 107, 155, 0.20)',
        },
        header: {
          borderBottom: '1px solid',
          borderBottomColor: 'gray.100',
          color: 'kartoza.700',
        },
        footer: {
          borderTop: '1px solid',
          borderTopColor: 'gray.100',
        },
      },
    },
    Input: {
      defaultProps: {
        focusBorderColor: 'kartoza.500',
      },
      baseStyle: {
        field: {
          borderRadius: '8px',
        },
      },
    },
    Select: {
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
        borderRadius: '6px',
        fontWeight: '600',
      },
      variants: {
        subtle: {
          bg: 'kartoza.50',
          color: 'kartoza.700',
        },
        solid: {
          bg: 'kartoza.500',
          color: 'white',
        },
        accent: {
          bg: 'accent.400',
          color: 'white',
        },
        accentSubtle: {
          bg: 'accent.50',
          color: 'accent.700',
        },
      },
    },
    Stat: {
      baseStyle: {
        container: {
          p: 4,
        },
        label: {
          color: 'gray.600',
          fontSize: 'sm',
          fontWeight: '500',
        },
        number: {
          color: 'kartoza.700',
          fontWeight: '700',
        },
        helpText: {
          color: 'gray.500',
        },
      },
    },
    Divider: {
      baseStyle: {
        borderColor: 'gray.200',
      },
    },
    Menu: {
      baseStyle: {
        list: {
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
          border: 'none',
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
        borderRadius: '8px',
        bg: 'gray.900',
        color: 'white',
        px: 3,
        py: 2,
      },
    },
    Alert: {
      variants: {
        subtle: {
          container: {
            borderRadius: '12px',
          },
        },
        solid: {
          container: {
            borderRadius: '12px',
          },
        },
      },
    },
  },
  semanticTokens: {
    colors: {
      primary: 'kartoza.500',
      'primary.dark': 'kartoza.700',
      'primary.light': 'kartoza.300',
      secondary: 'accent.400',
      success: '#4CAF50',
      error: '#E55B3C',
      warning: 'accent.400',
      info: 'kartoza.300',
    },
  },
})

export default theme
