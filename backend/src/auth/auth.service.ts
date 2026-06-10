import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(email: string, name: string, password: string, role?: string) {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const validRoles: UserRole[] = [
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.SALES,
      UserRole.OPERATIONS,
      UserRole.LIA,
      UserRole.SUPPORT,
      UserRole.STUDENT,
    ];
    let assignedRole: UserRole = UserRole.SALES;

    if (role) {
      if (!validRoles.includes(role as UserRole)) {
        throw new BadRequestException('Invalid role');
      }

      const existingUsersCount = await this.prisma.user.count();
      if (existingUsersCount === 0) {
        assignedRole = role as UserRole;
      } else {
        throw new BadRequestException('Role may only be assigned when bootstrapping the first user');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash: hashedPassword,
        role: assignedRole,
      },
    });

    // Generate JWT token
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token,
    };
  }

  async login(email: string, password: string) {
    // Guard: a malformed POST with no body (or no email/password key) used
    // to reach findUnique with `email: undefined`, which throws a
    // PrismaClientValidationError and surfaces as an opaque HTTP 500.
    // Treat missing credentials as the same 401 we use for wrong
    // credentials — no info leak, no Prisma noise in the logs.
    if (!email || !password) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Option C step 2 — passwordHash is now nullable. A Google-only
    // user (provisioned via OAuth, no password ever set) has null
    // here. Calling bcrypt.compare with null crashes the worker;
    // clean 401 with a different message tells the user to use the
    // Google button instead.
    if (!user.passwordHash) {
      throw new UnauthorizedException('This account uses Google sign-in');
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Generate JWT token
    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      token,
    };
  }
}
