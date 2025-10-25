import { useState } from 'react';
import TopBar from '../TopBar';

export default function TopBarExample() {
  const [searchValue, setSearchValue] = useState('');
  
  return (
    <TopBar 
      userRole="admin" 
      username="John Doe" 
      onSearchChange={setSearchValue}
      searchValue={searchValue}
    />
  );
}
