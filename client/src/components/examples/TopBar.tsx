import TopBar from '../TopBar';
import { SidebarProvider } from '@/components/ui/sidebar';

export default function TopBarExample() {
  return (
    <SidebarProvider>
      <TopBar 
        userRole="admin" 
        username="John Doe" 
      />
    </SidebarProvider>
  );
}
