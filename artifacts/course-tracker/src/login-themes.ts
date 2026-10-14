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

export type LoginThemeKey = 'student' | 'admin' | 'branch' | 'module';

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
    gradient: 'linear-gradient(135deg, #E3F4EA 0%, #F6FBF8 100%)',
    accent: '#1B5E4B',
    pale: '#D6F0E1',
    pillTint: '#D6F0E1',
    pillText: '#1B5E4B',
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
    gradient: 'linear-gradient(135deg, #E1EDFC 0%, #F4F8FE 100%)',
    accent: '#14508F',
    pale: '#D5E6FA',
    pillTint: '#D5E6FA',
    pillText: '#14508F',
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
    gradient: 'linear-gradient(135deg, #F8EEDC 0%, #FDF8EF 100%)',
    accent: '#A15C16',
    pale: '#F6E3C4',
    pillTint: '#F6E3C4',
    pillText: '#8A4B0F',
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
};
