import { extendTheme, type ThemeConfig } from '@chakra-ui/react'

// Kartoza brand colors - matching the Hugo website CSS variables
const colors = {
  // Primary blues
  kartoza: {
    50: '#e6f3fa',
    100: '#b3daf0',
    200: '#80c1e6',
    300: '#5BB5E8', // primary-light
    400: '#4da8de',
    500: '#3B9DD9', // primary - main blue
    600: '#2d8ac6',
    700: '#1B6B9B', // primary-dark
    800: '#155a84',
    900: '#0f4a6d',
  },
  // Orange/gold accent
  accent: {
    50: '#fef5e7',
    100: '#fce5c3',
    200: '#f9d59f',
    300: '#F0B84D', // accent-light
    400: '#E8A331', // accent - main orange
    500: '#D4922A', // accent-dark
    600: '#c08526',
    700: '#a67121',
    800: '#8c5d1c',
    900: '#724917',
  },
  // Grays matching Kartoza design
  gray: {
    50: '#f7f9fb', // light-bg
    100: '#e8ecf0', // light-bg-alt
    200: '#d4dbe2',
    300: '#C8C8C8',
    400: '#9E9E9E',
    500: '#6B7B8D',
    600: '#4D6370', // text-muted
    700: '#3d4f5f',
    800: '#2a3a4a',
    900: '#1a2a3a', // text-dark
  },
}

// Kartoza shadows matching homepage.css
const shadows = {
  sm: '0 2px 8px rgba(27, 107, 155, 0.08)',
  md: '0 4px 16px rgba(27, 107, 155, 0.12)',
  lg: '0 8px 32px rgba(27, 107, 155, 0.16)',
  xl: '0 16px 48px rgba(27, 107, 155, 0.20)',
  kartoza: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
  kartozaHover: '0 8px 28px rgba(27, 107, 155, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)',
  accent: '0 4px 20px rgba(232, 163, 49, 0.4)',
  accentHover: '0 6px 28px rgba(232, 163, 49, 0.5)',
}

// Border radii matching Kartoza design
const radii = {
  sm: '8px',
  md: '12px',
  lg: '20px',
  xl: '32px',
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
      // Custom CSS for Kartoza styling
      '.kartoza-gradient': {
        background: 'linear-gradient(135deg, #1B6B9B 0%, #3B9DD9 50%, #5BB5E8 100%)',
      },
      '.kartoza-card': {
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
        transition: 'box-shadow 0.3s ease, transform 0.3s ease',
        _hover: {
          boxShadow: '0 8px 28px rgba(27, 107, 155, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)',
          transform: 'translateY(-3px)',
        },
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
            bg: 'kartoza.600',
            boxShadow: '0 4px 14px rgba(27, 107, 155, 0.20)',
            transform: 'translateY(-1px)',
          },
        },
        outline: {
          borderColor: 'kartoza.500',
          borderWidth: '2px',
          color: 'kartoza.500',
          _hover: {
            bg: 'kartoza.50',
            transform: 'translateY(-1px)',
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
            bg: 'accent.500',
            boxShadow: '0 6px 28px rgba(232, 163, 49, 0.5)',
            transform: 'translateY(-2px)',
          },
        },
        'accent-outline': {
          borderColor: 'accent.400',
          borderWidth: '2px',
          color: 'accent.400',
          _hover: {
            bg: 'accent.50',
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
          color: 'kartoza.600',
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
        },
      },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(27, 107, 155, 0.10), 0 1px 4px rgba(0, 0, 0, 0.06)',
          transition: 'box-shadow 0.3s ease, transform 0.3s ease',
          overflow: 'hidden',
          _hover: {
            boxShadow: '0 8px 28px rgba(27, 107, 155, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)',
          },
        },
      },
      variants: {
        elevated: {
          container: {
            _hover: {
              transform: 'translateY(-3px)',
            },
          },
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
