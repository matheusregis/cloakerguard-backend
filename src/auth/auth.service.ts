import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { Types } from 'mongoose';

interface PayloadUser {
  _id: string | Types.ObjectId;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(dto: CreateUserDto): Promise<UserDocument> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new UnauthorizedException('Usuário já existe');

    const hash = await bcrypt.hash(dto.password, 10);
    return this.usersService.create(dto.email, dto.name, dto.lastName, hash);
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Credenciais inválidas');

    const payload = {
      _id: user._id.toString(),
      email: user.email,
      name: user.name,
    };
    const token = this.jwtService.sign(payload);

    return {
      access_token: token,
    };
  }

  generateToken(user: PayloadUser): string {
    const payload = {
      _id: user._id.toString(),
      email: user.email,
      name: user.name,
    };
    return this.jwtService.sign(payload);
  }
}
