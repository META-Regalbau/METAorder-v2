import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";

export async function seedDatabase(storage: IStorage) {
  try {
    // Check if admin user already exists
    const existingAdmin = await storage.getUserByUsername("admin");
    
    if (!existingAdmin) {
      console.log("Seeding initial users...");
      
      // Create admin user
      const adminPassword = await bcrypt.hash("admin123", 10);
      await storage.createUser({
        username: "admin",
        password: adminPassword,
      });
      
      // Update the admin user to have admin role and all sales channels
      const admin = await storage.getUserByUsername("admin");
      if (admin) {
        // Note: This is a workaround since MemStorage doesn't have updateUser yet
        // In production with DB, you'd use storage.updateUser
        (admin as any).role = "admin";
        (admin as any).salesChannelIds = null; // null = all channels
      }
      
      // Create employee user for Austria
      const employeePassword = await bcrypt.hash("employee123", 10);
      const austriaEmployee = await storage.createUser({
        username: "austria",
        password: employeePassword,
      });
      (austriaEmployee as any).salesChannelIds = ["0190b599291076e3beecdfca3d1b1b30"]; // Austria
      
      // Create employee user for Poland
      const polandEmployee = await storage.createUser({
        username: "poland",
        password: employeePassword,
      });
      (polandEmployee as any).salesChannelIds = ["0193595640017e1ab0b5ae3313b4181c"]; // Poland
      
      console.log("Database seeded successfully!");
      console.log("Admin credentials: username=admin, password=admin123");
      console.log("Employee credentials: username=austria/poland, password=employee123");
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
