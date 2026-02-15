/**
 * Animation utilities with spring physics for delightful UI transitions
 *
 * Design Philosophy:
 * - Purposeful motion that guides user attention
 * - Spring physics for natural, organic feel
 * - Micro-interactions that reward engagement
 * - Subtle surprises that delight without distracting
 */

import { Variants, Transition } from 'framer-motion';

// ============================================================================
// Spring Configurations - Natural physics-based motion
// ============================================================================

export const springs = {
  // Gentle, relaxed motion for ambient elements
  gentle: { type: 'spring', stiffness: 120, damping: 14, mass: 1 } as Transition,

  // Default spring for most UI elements
  default: { type: 'spring', stiffness: 300, damping: 24, mass: 1 } as Transition,

  // Snappy response for interactive elements
  snappy: { type: 'spring', stiffness: 400, damping: 28, mass: 0.8 } as Transition,

  // Bouncy for playful elements and celebrations
  bouncy: { type: 'spring', stiffness: 500, damping: 15, mass: 1 } as Transition,

  // Wobbly for attention-grabbing moments
  wobbly: { type: 'spring', stiffness: 180, damping: 12, mass: 1.2 } as Transition,

  // Stiff for precise, controlled motion
  stiff: { type: 'spring', stiffness: 600, damping: 35, mass: 0.5 } as Transition,
};

// ============================================================================
// Modal and Dialog Animations
// ============================================================================

export const modalBackdrop: Variants = {
  hidden: {
    opacity: 0,
    backdropFilter: 'blur(0px)',
  },
  visible: {
    opacity: 1,
    backdropFilter: 'blur(8px)',
    transition: { duration: 0.3 }
  },
  exit: {
    opacity: 0,
    backdropFilter: 'blur(0px)',
    transition: { duration: 0.2 }
  }
};

export const modalContent: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springs.bouncy
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -10,
    transition: { duration: 0.15 }
  }
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springs.default
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.15 }
  }
};

export const slideDown: Variants = {
  hidden: { opacity: 0, y: -30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springs.default
  },
  exit: {
    opacity: 0,
    y: 20,
    transition: { duration: 0.15 }
  }
};

export const slideLeft: Variants = {
  hidden: { opacity: 0, x: 30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: springs.default
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.15 }
  }
};

export const slideRight: Variants = {
  hidden: { opacity: 0, x: -30 },
  visible: {
    opacity: 1,
    x: 0,
    transition: springs.default
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.15 }
  }
};

// ============================================================================
// Panel Animations (for sidebars, drawers, expandable sections)
// ============================================================================

export const panelSlide: Variants = {
  hidden: {
    x: '-100%',
    opacity: 0.5,
  },
  visible: {
    x: 0,
    opacity: 1,
    transition: springs.snappy
  },
  exit: {
    x: '-100%',
    opacity: 0,
    transition: { duration: 0.2 }
  }
};

export const expandCollapse: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2 }
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: springs.gentle
  }
};

// ============================================================================
// List and Stagger Animations
// ============================================================================

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    }
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    }
  }
};

export const staggerItem: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springs.snappy
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.1 }
  }
};

export const listItemHover = {
  scale: 1.01,
  x: 4,
  backgroundColor: 'rgba(59, 130, 246, 0.05)',
  transition: springs.snappy
};

// ============================================================================
// Tree Node Animations
// ============================================================================

export const treeNodeExpand: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2 }
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      height: springs.gentle,
      opacity: { duration: 0.2, delay: 0.1 }
    }
  }
};

export const treeChevron: Variants = {
  collapsed: { rotate: 0 },
  expanded: {
    rotate: 90,
    transition: springs.snappy
  }
};

// ============================================================================
// Button and Interactive Element Animations
// ============================================================================

export const buttonTap = {
  scale: 0.97,
  transition: { duration: 0.1 }
};

export const buttonHover = {
  scale: 1.02,
  transition: springs.snappy
};

export const iconSpin = {
  rotate: 360,
  transition: {
    duration: 1,
    repeat: Infinity,
    ease: 'linear'
  }
};

export const pulseGlow = {
  scale: [1, 1.05, 1],
  opacity: [0.7, 1, 0.7],
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: 'easeInOut'
  }
};

// ============================================================================
// Success, Error, and Feedback Animations
// ============================================================================

export const successPop: Variants = {
  hidden: {
    scale: 0,
    opacity: 0,
    rotate: -180,
  },
  visible: {
    scale: 1,
    opacity: 1,
    rotate: 0,
    transition: springs.bouncy
  }
};

export const errorShake: Variants = {
  shake: {
    x: [0, -10, 10, -10, 10, -5, 5, 0],
    transition: { duration: 0.5 }
  }
};

export const warningPulse = {
  scale: [1, 1.05, 1],
  transition: {
    duration: 0.6,
    repeat: 2,
  }
};

export const checkmarkDraw: Variants = {
  hidden: {
    pathLength: 0,
    opacity: 0,
  },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 0.4, ease: 'easeOut' },
      opacity: { duration: 0.1 }
    }
  }
};

// ============================================================================
// Loading and Progress Animations
// ============================================================================

export const loadingDots: Variants = {
  start: { y: 0 },
  bounce: {
    y: [-5, 0],
    transition: {
      duration: 0.4,
      repeat: Infinity,
      repeatType: 'reverse' as const,
    }
  }
};

export const progressBar = {
  initial: { scaleX: 0, originX: 0 },
  animate: (progress: number) => ({
    scaleX: progress,
    transition: springs.gentle
  })
};

export const skeletonShimmer = {
  backgroundPosition: ['200% 0', '-200% 0'],
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: 'linear'
  }
};

// ============================================================================
// Tooltip and Popover Animations
// ============================================================================

export const tooltip: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    y: 5,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springs.snappy
  }
};

export const popover: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: -5,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springs.default
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.1 }
  }
};

// ============================================================================
// Page and View Transitions
// ============================================================================

export const pageTransition: Variants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  enter: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
    }
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.2,
    }
  }
};

export const fadeInOut: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2 }
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 }
  }
};

// ============================================================================
// Delightful Micro-interactions and Surprises
// ============================================================================

// Confetti burst for celebrations
export const confettiBurst = {
  hidden: { scale: 0, opacity: 0 },
  visible: (i: number) => ({
    scale: [0, 1.5, 0],
    opacity: [0, 1, 0],
    x: Math.cos(i * 0.5) * (50 + Math.random() * 100),
    y: Math.sin(i * 0.5) * (50 + Math.random() * 100) - 50,
    rotate: Math.random() * 360,
    transition: {
      duration: 0.6 + Math.random() * 0.4,
      ease: 'easeOut',
    }
  })
};

// Sparkle effect for special moments
export const sparkle = {
  hidden: { scale: 0, opacity: 0, rotate: 0 },
  visible: {
    scale: [0, 1.2, 0],
    opacity: [0, 1, 0],
    rotate: [0, 180],
    transition: {
      duration: 0.6,
      ease: 'easeOut',
    }
  }
};

// Gentle floating animation for ambient elements
export const gentleFloat = {
  y: [0, -8, 0],
  transition: {
    duration: 3,
    repeat: Infinity,
    ease: 'easeInOut',
  }
};

// Heartbeat for important notifications
export const heartbeat = {
  scale: [1, 1.15, 1, 1.1, 1],
  transition: {
    duration: 0.8,
    repeat: Infinity,
    repeatDelay: 1,
  }
};

// Wiggle for attention
export const wiggle = {
  rotate: [0, -3, 3, -3, 3, 0],
  transition: {
    duration: 0.5,
  }
};

// Morph between shapes
export const morphTransition = {
  type: 'spring',
  stiffness: 200,
  damping: 20,
  mass: 1,
};

// ============================================================================
// Form and Input Animations
// ============================================================================

export const inputFocus: Variants = {
  unfocused: {
    boxShadow: '0 0 0 0 rgba(59, 130, 246, 0)',
    borderColor: '#e5e7eb',
  },
  focused: {
    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)',
    borderColor: '#3b82f6',
    transition: springs.snappy
  }
};

export const labelFloat: Variants = {
  resting: {
    y: 0,
    scale: 1,
    color: '#9ca3af',
  },
  floating: {
    y: -24,
    scale: 0.85,
    color: '#3b82f6',
    transition: springs.snappy
  }
};

export const validationMessage: Variants = {
  hidden: {
    opacity: 0,
    y: -5,
    height: 0,
  },
  visible: {
    opacity: 1,
    y: 0,
    height: 'auto',
    transition: springs.snappy
  }
};

// ============================================================================
// Card and Content Block Animations
// ============================================================================

export const cardHover = {
  y: -4,
  boxShadow: '0 20px 40px -12px rgba(0, 0, 0, 0.15)',
  transition: springs.snappy
};

export const cardAppear: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springs.default
  }
};

// ============================================================================
// Notification and Toast Animations
// ============================================================================

export const toastSlideIn: Variants = {
  hidden: {
    x: 100,
    opacity: 0,
  },
  visible: {
    x: 0,
    opacity: 1,
    transition: springs.bouncy
  },
  exit: {
    x: 100,
    opacity: 0,
    transition: { duration: 0.2 }
  }
};

export const notificationBadge: Variants = {
  hidden: { scale: 0 },
  visible: {
    scale: 1,
    transition: springs.bouncy
  },
  pulse: {
    scale: [1, 1.2, 1],
    transition: {
      duration: 0.3,
    }
  }
};

// ============================================================================
// Drag and Drop Animations
// ============================================================================

export const draggable = {
  drag: {
    scale: 1.05,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    cursor: 'grabbing',
  },
  idle: {
    scale: 1,
    boxShadow: '0 0 0 0 rgba(0, 0, 0, 0)',
    cursor: 'grab',
  }
};

export const dropTarget: Variants = {
  inactive: {
    backgroundColor: 'transparent',
    borderColor: '#e5e7eb',
  },
  active: {
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderColor: '#3b82f6',
    transition: springs.snappy
  }
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a staggered delay for list items
 */
export const getStaggerDelay = (index: number, baseDelay = 0.05) => ({
  transition: { delay: index * baseDelay }
});

/**
 * Creates a random rotation for playful elements
 */
export const getRandomRotation = (maxDegrees = 5) => ({
  rotate: (Math.random() - 0.5) * maxDegrees * 2
});

/**
 * Creates spring animation with custom parameters
 */
export const createSpring = (stiffness = 300, damping = 24, mass = 1): Transition => ({
  type: 'spring',
  stiffness,
  damping,
  mass,
});

/**
 * Generates confetti particles configuration
 */
export const generateConfetti = (count = 20) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5],
    size: 8 + Math.random() * 8,
  }));
