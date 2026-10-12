export type UserRole = 'cliente' | 'empleado' | 'admin';

export interface SavedPaymentMethod {
  brand: 'Visa' | 'Mastercard' | 'Demo';
  lastFour: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName?: string;
  phone?: string;
  savedPaymentMethod?: SavedPaymentMethod;
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}
