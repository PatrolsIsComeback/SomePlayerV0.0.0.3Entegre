'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function AccessCodeModal() {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Lütfen bir erişim kodu giriniz');
      return;
    }

    if (!isMounted) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Kod doğrulanırken bir hata oluştu');
      }

      // Store access token in localStorage
      localStorage.setItem('accessCode', code);
      
      // Refresh the page to show the main content
      window.location.reload();
      
    } catch (err) {
      console.error('Error verifying code:', err);
      setError(err instanceof Error ? err.message : 'Geçersiz kod veya bir hata oluştu');
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Erişim Kodu Gerekli</CardTitle>
          <CardDescription>
            Devam etmek için geçerli bir erişim kodu giriniz.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Erişim kodunuzu giriniz"
                  className="w-full"
                  autoFocus
                />
                {error && (
                  <p className="mt-2 text-sm text-red-600 flex items-center">
                    <XCircle className="h-4 w-4 mr-1" />
                    {error}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Doğrulanıyor...
                </>
              ) : (
                'Giriş Yap'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
