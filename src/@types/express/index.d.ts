import { User } from '../../users/schemas/user.schema';

declare namespace Express {
  export interface Request {
    user?: User;
  }
}
