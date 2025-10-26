import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";

export async function seedDatabase(storage: IStorage) {
  try {
    // Create default roles first
    const roles = await storage.getAllRoles();
    
    if (roles.length === 0) {
      console.log("Seeding default roles...");
      
      const administratorRole = await storage.createRole({
        name: "Administrator",
        salesChannelIds: undefined,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: true,
          viewAnalytics: true,
          manageUsers: true,
          manageRoles: true,
          manageSettings: true,
          manageCrossSellingGroups: true,
          manageCrossSellingRules: true,
        },
      });
      
      const employeeRole = await storage.createRole({
        name: "Employee",
        salesChannelIds: undefined,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: false,
          viewAnalytics: false,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: false,
          manageCrossSellingRules: false,
        },
      });
      
      const warehouseManagerRole = await storage.createRole({
        name: "Warehouse Manager",
        salesChannelIds: undefined,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: true,
          viewAnalytics: true,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: true,
          manageCrossSellingRules: true,
        },
      });
      
      console.log("Default roles created!");
      
      // Check if admin user already exists
      const existingAdmin = await storage.getUserByUsername("admin");
      
      if (!existingAdmin) {
        console.log("Seeding initial users...");
        
        // Create admin user
        const adminPassword = await bcrypt.hash("admin123", 10);
        const adminUser = await storage.createUser({
          username: "admin",
          password: adminPassword,
        });
        
        await storage.updateUser(adminUser.id, {
          role: "admin",
          roleId: administratorRole.id,
          salesChannelIds: null,
        });
        
        // Create employee user for Austria
        const employeePassword = await bcrypt.hash("employee123", 10);
        const austriaEmployee = await storage.createUser({
          username: "austria",
          password: employeePassword,
        });
        
        await storage.updateUser(austriaEmployee.id, {
          role: "employee",
          roleId: employeeRole.id,
          salesChannelIds: ["0190b599291076e3beecdfca3d1b1b30"],
        });
        
        // Create employee user for Poland
        const polandEmployee = await storage.createUser({
          username: "poland",
          password: employeePassword,
        });
        
        await storage.updateUser(polandEmployee.id, {
          role: "employee",
          roleId: employeeRole.id,
          salesChannelIds: ["0193595640017e1ab0b5ae3313b4181c"],
        });
        
        console.log("Database seeded successfully!");
        console.log("Admin credentials: username=admin, password=admin123");
        console.log("Employee credentials: username=austria/poland, password=employee123");
      }
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
