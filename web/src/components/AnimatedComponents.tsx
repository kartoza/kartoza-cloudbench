/**
 * Animated UI Components
 *
 * A collection of beautifully animated components that bring
 * life and delight to the user interface through physics-based
 * motion and thoughtful micro-interactions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  modalBackdrop,
  modalContent,
  slideUp,
  staggerContainer,
  staggerItem,
  buttonTap,
  buttonHover,
  successPop,
  errorShake,
  toastSlideIn,
  springs,
  cardHover,
  expandCollapse,
  treeChevron,
  tooltip as tooltipVariants,
  confettiBurst,
  sparkle,
  heartbeat,
  wiggle,
  generateConfetti,
} from '../utils/animations';

// ============================================================================
// Animated Modal
// ============================================================================

interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnBackdrop?: boolean;
}

export const AnimatedModal: React.FC<AnimatedModalProps> = ({
  isOpen,
  onClose,
  children,
  size = 'md',
  closeOnBackdrop = true,
}) => {
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] max-h-[95vh]',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50"
            variants={modalBackdrop}
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Content */}
          <motion.div
            className={`relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ${sizeClasses[size]} w-full overflow-hidden`}
            variants={modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Animated Button
// ============================================================================

interface AnimatedButtonProps {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

export const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  children,
  className = '',
  disabled,
  onClick,
  type = 'button',
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

  const variantStyles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300 focus:ring-gray-400 dark:bg-gray-700 dark:text-gray-200',
    success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    ghost: 'text-gray-600 hover:bg-gray-100 focus:ring-gray-300 dark:text-gray-400 dark:hover:bg-gray-800',
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2',
  };

  return (
    <motion.button
      type={type}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className} ${
        disabled || isLoading ? 'opacity-60 cursor-not-allowed' : ''
      }`}
      whileHover={!disabled && !isLoading ? buttonHover : undefined}
      whileTap={!disabled && !isLoading ? buttonTap : undefined}
      disabled={disabled || isLoading}
      onClick={onClick}
    >
      {isLoading ? (
        <motion.div
          className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
      ) : icon ? (
        <motion.span
          initial={{ scale: 1 }}
          whileHover={{ scale: 1.1, rotate: 5 }}
          transition={springs.snappy}
        >
          {icon}
        </motion.span>
      ) : null}
      <span>{children}</span>
    </motion.button>
  );
};

// ============================================================================
// Animated Card
// ============================================================================

interface AnimatedCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
  delay?: number;
}

export const AnimatedCard: React.FC<AnimatedCardProps> = ({
  children,
  className = '',
  onClick,
  hoverable = true,
  delay = 0,
}) => {
  return (
    <motion.div
      className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.default, delay }}
      whileHover={hoverable ? cardHover : undefined}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
};

// ============================================================================
// Animated List
// ============================================================================

interface AnimatedListProps {
  children: React.ReactNode;
  className?: string;
}

export const AnimatedList: React.FC<AnimatedListProps> = ({ children, className = '' }) => {
  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
};

interface AnimatedListItemProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const AnimatedListItem: React.FC<AnimatedListItemProps> = ({
  children,
  className = '',
  onClick,
}) => {
  return (
    <motion.div
      className={`${className} ${onClick ? 'cursor-pointer' : ''}`}
      variants={staggerItem}
      whileHover={{
        x: 4,
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        transition: springs.snappy,
      }}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
};

// ============================================================================
// Animated Expandable Section
// ============================================================================

interface AnimatedExpandableProps {
  isExpanded: boolean;
  children: React.ReactNode;
  className?: string;
}

export const AnimatedExpandable: React.FC<AnimatedExpandableProps> = ({
  isExpanded,
  children,
  className = '',
}) => {
  return (
    <AnimatePresence initial={false}>
      {isExpanded && (
        <motion.div
          className={`overflow-hidden ${className}`}
          initial="collapsed"
          animate="expanded"
          exit="collapsed"
          variants={expandCollapse}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Animated Chevron (for expandable items)
// ============================================================================

interface AnimatedChevronProps {
  isExpanded: boolean;
  className?: string;
}

export const AnimatedChevron: React.FC<AnimatedChevronProps> = ({
  isExpanded,
  className = '',
}) => {
  return (
    <motion.svg
      className={`w-4 h-4 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      variants={treeChevron}
      animate={isExpanded ? 'expanded' : 'collapsed'}
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </motion.svg>
  );
};

// ============================================================================
// Animated Success Checkmark
// ============================================================================

interface AnimatedCheckmarkProps {
  show: boolean;
  size?: number;
  color?: string;
}

export const AnimatedCheckmark: React.FC<AnimatedCheckmarkProps> = ({
  show,
  size = 48,
  color = '#10b981',
}) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          variants={successPop}
          initial="hidden"
          animate="visible"
          exit="hidden"
          className="inline-flex items-center justify-center"
        >
          <svg width={size} height={size} viewBox="0 0 52 52">
            <motion.circle
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke={color}
              strokeWidth="2"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
            <motion.path
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 27l8 8 16-16"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: 0.2, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Animated Error Icon with Shake
// ============================================================================

interface AnimatedErrorProps {
  show: boolean;
  message?: string;
}

export const AnimatedError: React.FC<AnimatedErrorProps> = ({ show, message }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="flex items-center gap-2 text-red-600"
          variants={errorShake}
          initial="shake"
          animate="shake"
        >
          <motion.div
            className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.bouncy}
          >
            <span className="text-red-600 text-sm font-bold">!</span>
          </motion.div>
          {message && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={springs.snappy}
              className="text-sm"
            >
              {message}
            </motion.span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Animated Toast Notification
// ============================================================================

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  isVisible: boolean;
  onClose?: () => void;
  duration?: number;
}

export const AnimatedToast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  isVisible,
  onClose,
  duration = 4000,
}) => {
  useEffect(() => {
    if (isVisible && onClose && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose, duration]);

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500',
  };

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className={`fixed bottom-4 right-4 ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50`}
          variants={toastSlideIn}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.span
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={springs.bouncy}
            className="text-lg"
          >
            {icons[type]}
          </motion.span>
          <span>{message}</span>
          {onClose && (
            <motion.button
              className="ml-2 hover:opacity-80"
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Animated Tooltip
// ============================================================================

interface AnimatedTooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const AnimatedTooltip: React.FC<AnimatedTooltipProps> = ({
  content,
  children,
  position = 'top',
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionStyles = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            className={`absolute ${positionStyles[position]} px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap z-50`}
            variants={tooltipVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Animated Progress Bar
// ============================================================================

interface AnimatedProgressProps {
  progress: number; // 0-100
  color?: string;
  height?: number;
  showLabel?: boolean;
}

export const AnimatedProgress: React.FC<AnimatedProgressProps> = ({
  progress,
  color = '#3b82f6',
  height = 8,
  showLabel = false,
}) => {
  const springProgress = useSpring(progress / 100, { stiffness: 120, damping: 14 });

  return (
    <div className="relative">
      <div
        className="w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        style={{ height }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            backgroundColor: color,
            scaleX: springProgress,
            originX: 0,
          }}
        />
      </div>
      {showLabel && (
        <motion.span
          className="absolute right-0 -top-6 text-sm text-gray-600"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {Math.round(progress)}%
        </motion.span>
      )}
    </div>
  );
};

// ============================================================================
// Animated Counter (numbers that animate to their value)
// ============================================================================

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  formatFn?: (val: number) => string;
  className?: string;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 1,
  formatFn = (v) => Math.round(v).toString(),
  className = '',
}) => {
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { duration: duration * 1000 });
  const displayValue = useTransform(springValue, formatFn);
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    return displayValue.on('change', (latest) => {
      setDisplay(latest);
    });
  }, [displayValue]);

  return <span className={className}>{display}</span>;
};

// ============================================================================
// Confetti Celebration
// ============================================================================

interface ConfettiProps {
  trigger: boolean;
  count?: number;
}

export const Confetti: React.FC<ConfettiProps> = ({ trigger, count = 30 }) => {
  const [particles, setParticles] = useState<
    { id: number; color: string; size: number; x: number; y: number }[]
  >([]);

  useEffect(() => {
    if (trigger) {
      const newParticles = generateConfetti(count).map((p) => ({
        ...p,
        x: Math.random() * 200 - 100,
        y: Math.random() * -100 - 50,
      }));
      setParticles(newParticles);

      const timer = setTimeout(() => setParticles([]), 1500);
      return () => clearTimeout(timer);
    }
  }, [trigger, count]);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <div className="absolute top-1/2 left-1/2">
        <AnimatePresence>
          {particles.map((particle) => (
            <motion.div
              key={particle.id}
              className="absolute rounded-sm"
              style={{
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
              }}
              variants={confettiBurst}
              initial="hidden"
              animate="visible"
              exit="hidden"
              custom={particle.id}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ============================================================================
// Sparkle Effect
// ============================================================================

interface SparkleProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export const SparkleWrapper: React.FC<SparkleProps> = ({ children, enabled = true }) => {
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([]);

  const addSparkle = useCallback(() => {
    if (!enabled) return;

    const id = Date.now();
    const x = Math.random() * 100;
    const y = Math.random() * 100;

    setSparkles((prev) => [...prev, { id, x, y }]);

    setTimeout(() => {
      setSparkles((prev) => prev.filter((s) => s.id !== id));
    }, 600);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(addSparkle, 1500 + Math.random() * 1000);
    return () => clearInterval(interval);
  }, [enabled, addSparkle]);

  return (
    <div className="relative inline-block">
      {children}
      {sparkles.map((s) => (
        <motion.div
          key={s.id}
          className="absolute pointer-events-none"
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
          variants={sparkle}
          initial="hidden"
          animate="visible"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fbbf24">
            <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
          </svg>
        </motion.div>
      ))}
    </div>
  );
};

// ============================================================================
// Pulsing Dot (for status indicators)
// ============================================================================

interface PulsingDotProps {
  color?: 'green' | 'red' | 'yellow' | 'blue';
  size?: 'sm' | 'md' | 'lg';
}

export const PulsingDot: React.FC<PulsingDotProps> = ({ color = 'green', size = 'md' }) => {
  const colors = {
    green: 'bg-green-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    blue: 'bg-blue-500',
  };

  const sizes = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  return (
    <span className="relative flex">
      <motion.span
        className={`absolute inline-flex h-full w-full rounded-full ${colors[color]} opacity-75`}
        animate={{
          scale: [1, 1.5, 1],
          opacity: [0.75, 0, 0.75],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      <span className={`relative inline-flex rounded-full ${sizes[size]} ${colors[color]}`} />
    </span>
  );
};

// ============================================================================
// Animated Icon Button (with wiggle on hover)
// ============================================================================

interface AnimatedIconButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  label?: string;
  variant?: 'default' | 'danger' | 'success';
  disabled?: boolean;
}

export const AnimatedIconButton: React.FC<AnimatedIconButtonProps> = ({
  icon,
  onClick,
  label,
  variant = 'default',
  disabled = false,
}) => {
  const variantStyles = {
    default: 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400',
    danger: 'hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600',
    success: 'hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600',
  };

  return (
    <motion.button
      className={`p-2 rounded-lg transition-colors ${variantStyles[variant]} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      onClick={disabled ? undefined : onClick}
      whileHover={disabled ? undefined : wiggle}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      title={label}
      disabled={disabled}
    >
      {icon}
    </motion.button>
  );
};

// ============================================================================
// Animated Badge
// ============================================================================

interface AnimatedBadgeProps {
  count: number;
  max?: number;
  color?: 'red' | 'blue' | 'green' | 'yellow';
}

export const AnimatedBadge: React.FC<AnimatedBadgeProps> = ({
  count,
  max = 99,
  color = 'red',
}) => {
  const colors = {
    red: 'bg-red-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
  };

  const displayCount = count > max ? `${max}+` : count;

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          className={`absolute -top-1 -right-1 ${colors[color]} text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={springs.bouncy}
        >
          <motion.span
            key={count}
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={springs.snappy}
          >
            {displayCount}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// Page Transition Wrapper
// ============================================================================

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children, className = '' }) => {
  return (
    <motion.div
      className={className}
      variants={slideUp}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
};

// ============================================================================
// Heartbeat attention indicator
// ============================================================================

interface HeartbeatProps {
  children: React.ReactNode;
  active?: boolean;
}

export const Heartbeat: React.FC<HeartbeatProps> = ({ children, active = true }) => {
  return (
    <motion.div animate={active ? heartbeat : undefined}>
      {children}
    </motion.div>
  );
};

export default {
  AnimatedModal,
  AnimatedButton,
  AnimatedCard,
  AnimatedList,
  AnimatedListItem,
  AnimatedExpandable,
  AnimatedChevron,
  AnimatedCheckmark,
  AnimatedError,
  AnimatedToast,
  AnimatedTooltip,
  AnimatedProgress,
  AnimatedCounter,
  Confetti,
  SparkleWrapper,
  PulsingDot,
  AnimatedIconButton,
  AnimatedBadge,
  PageTransition,
  Heartbeat,
};
