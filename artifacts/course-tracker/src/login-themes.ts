/**
 * Login-screen theming — the ONE central place for the colours, badge icon and
 * illustration of the four sign-in screens (Student, Admin, Branch, Module
 * desk). `AuthShell` reads a theme by key and renders the shared layout; no
 * page hard-codes a colour or an illustration. Edit a value here and every
 * login screen moves.
 *
 * The text values below are the wording the app already shows — they are kept
 * here verbatim and must not be reworded.
 */
import { Box, Building2, GraduationCap, Settings, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  AdminIllustration,
  BranchDefaultArt,
  ModuleDefaultArt,
  StudentIllustration,
  type LoginIllustrationProps,
} from './components/login-illustrations';

export type LoginThemeKey = 'student' | 'admin' | 'branch' | 'zedking' | 'module';

export type LoginThemeConfig = {
  /** Page background gradient. */
  gradient: string;
  /** Dark panel colour — the button fill and accent values. */
  accent: string;
  /** Pale tint behind the circular illustration. */
  pale: string;
  /** Badge pill background and text. */
  pillTint: string;
  pillText: string;
  badgeIcon: LucideIcon;
  badgeText: string;
  heading: string;
  subtitle: string;
  idPlaceholder: string;
  passwordPlaceholder: string;
  buttonLabel: string;
  /** Decorative artwork shown in the art area (SVG illustration or supplied image). */
  Illustration: ComponentType<LoginIllustrationProps>;
};

export const LOGIN_THEMES: Record<LoginThemeKey, LoginThemeConfig> = {
  student: {
    gradient: 'linear-gradient(135deg, hsl(38 44% 96%) 0%, hsl(38 44% 99%) 100%)',
    accent: 'hsl(26 8% 17%)',
    pale: 'hsl(19 100% 89%)',
    pillTint: 'hsl(19 100% 89%)',
    pillText: 'hsl(18 60% 32%)',
    badgeIcon: GraduationCap,
    badgeText: 'Student',
    heading: 'Sign in to your account',
    subtitle: 'Access your classes, study material and more.',
    idPlaceholder: 'Enter your student ID',
    passwordPlaceholder: 'Enter your password',
    buttonLabel: 'Login',
    Illustration: StudentIllustration,
  },
  admin: {
    gradient: 'linear-gradient(135deg, hsl(220 38% 97%) 0%, hsl(220 38% 99%) 100%)',
    accent: 'hsl(221 51% 16%)',
    pale: 'hsl(42 100% 91%)',
    pillTint: 'hsl(42 100% 91%)',
    pillText: 'hsl(221 51% 16%)',
    badgeIcon: Settings,
    badgeText: 'Admin',
    heading: 'Sign in to your account',
    subtitle: 'Manage users, branches, modules and all activities.',
    idPlaceholder: 'Enter your admin ID',
    passwordPlaceholder: 'Enter your password',
    buttonLabel: 'Login',
    Illustration: AdminIllustration,
  },
  branch: {
    gradient: 'linear-gradient(135deg, hsl(247 53% 97%) 0%, hsl(247 53% 99%) 100%)',
    accent: 'hsl(238 44% 30%)',
    pale: 'hsl(244 100% 92%)',
    pillTint: 'hsl(244 100% 92%)',
    pillText: 'hsl(238 44% 30%)',
    badgeIcon: Building2,
    badgeText: 'Branch',
    heading: 'Sign in to your branch',
    subtitle: 'Manage admissions, student progress, batches and reports.',
    idPlaceholder: 'Enter your branch ID',
    passwordPlaceholder: 'Enter your password',
    buttonLabel: 'Login',
    Illustration: BranchDefaultArt,
  },
  module: {
    gradient: 'linear-gradient(135deg, #E8E2FA 0%, #F5F2FD 100%)',
    accent: '#4C2488',
    pale: '#DDD3F7',
    pillTint: '#DDD3F7',
    pillText: '#4C2488',
    badgeIcon: Box,
    badgeText: 'Module',
    heading: 'Sign in to your desk',
    subtitle: 'Access and manage your module workspace.',
    idPlaceholder: 'Enter your owner ID',
    passwordPlaceholder: 'Enter your password',
    buttonLabel: 'Open desk',
    Illustration: ModuleDefaultArt,
  },
  zedking: {
    gradient: 'linear-gradient(135deg, hsl(146 33% 96%) 0%, hsl(146 33% 99%) 100%)',
    accent: 'hsl(162 67% 18%)',
    pale: 'hsl(141 45% 81%)',
    pillTint: 'hsl(141 45% 81%)',
    pillText: 'hsl(162 67% 18%)',
    badgeIcon: Building2,
    badgeText: 'Zedking',
    heading: 'Sign in to your branch',
    subtitle: 'Manage admissions, student progress, batches and reports.',
    idPlaceholder: 'Enter your branch ID',
    passwordPlaceholder: 'Enter your password',
    buttonLabel: 'Login',
    Illustration: BranchDefaultArt,
  },
};
